// ============================================================
// MY CELLAR — Secure Claude API Proxy
// Runs on Netlify's servers. API key never exposed to browser.
// Handles: wine search lookups + label scan
// ============================================================

exports.handler = async (event) => {
  // Only allow POST requests from your own app
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Allow requests from any netlify.app subdomain or localhost
  const origin = event.headers.origin || '';
  const isAllowed = !origin || origin.includes('netlify.app') || origin.includes('localhost') || origin.includes('redcellar');
  if (!isAllowed) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Parse the request body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { type, payload } = body;

  // Build the prompt based on request type
  let messages, max_tokens;

  if (type === 'wine_search') {
    // Wine name lookup
    const { query } = payload;
    if (!query || query.trim().length < 2) {
      return { statusCode: 400, body: 'Query too short' };
    }
    max_tokens = 800;
    messages = [{
      role: 'user',
      content: `You are a wine encyclopedia. The user typed: "${query.trim()}"

Identify the most likely wine this refers to. Be generous with partial names, typos, bin numbers and shorthand (e.g. "Bin 8", "Grange", "Cloudy Bay SB", "Marg" for Margaux). Always return your best match — never say you don't know.

Return ONLY a valid JSON object — no markdown, no backticks, no explanation.

Return exactly this structure:
{
  "name": "full wine name e.g. Penfolds Bin 8 Cabernet Shiraz",
  "producer": "winery or producer name e.g. Penfolds",
  "type": "red or white or rose or sparkling or dessert",
  "country": "country of origin",
  "region": "wine region or appellation",
  "grape": "primary grape variety or blend",
  "vintage": null,
  "description": "one sentence describing the wine style and character",
  "flavours": ["up to 6 typical flavour tags from this list only: Red berries, Dark berries, Black cherry, Stone fruit, Citrus, Tropical, Apple & pear, Dried fruit, Rose petal, Violet, Jasmine, Cedar, Black pepper, Vanilla, Toasty oak, Cinnamon, Clove, Mushroom, Forest floor, Mineral, Herbaceous, Grassy, Leather, Smoky, Meaty, Tobacco, Crisp & clean, Zesty, Fresh & bright, Light-bodied, Bubbly, Full-bodied, Tannic, Velvety, Silky, Honey, Caramel, Chocolate, Cream"],
  "pairings": ["up to 5 food pairings from: Steak, Lamb, Pork, Duck, Chicken, BBQ, Charcuterie, Seafood, Salmon, Sushi, Oysters, Pasta, Pizza, Salads, Vegetarian, Cheese, Goat cheese, Dessert, Chocolate, Just sipping, Celebrations, Picnic, Spicy food, Tapas"]
}

Rules:
- type must be exactly one of: red, white, rose, sparkling, dessert
- vintage is null unless the user specified a year
- Always make your best guess — never leave name, producer, type, country, region or grape as null
- For bin numbers like "Bin 8", "Bin 389", "Bin 407" — these are Penfolds wines, identify them correctly`
    }];

  } else if (type === 'label_scan') {
    // Label photo scan
    const { base64, mimeType } = payload;
    if (!base64 || !mimeType) {
      return { statusCode: 400, body: 'Missing image data' };
    }
    max_tokens = 600;
    messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        },
        {
          type: 'text',
          text: `You are a wine label reader. Look at this wine label and extract details. Respond ONLY with a valid JSON object, no markdown or backticks.

Return exactly: {"name":"wine name","producer":"winery name","vintage":2019,"type":"red or white or rose or sparkling or dessert","country":"country","region":"region or appellation","grape":"grape variety"}

Rules: vintage is a number or null. type must be one of the five options. Use null for anything not visible.`
        }
      ]
    }];

  } else {
    return { statusCode: 400, body: 'Unknown request type' };
  }

  // Call Anthropic API with the secret key (stored in Netlify env vars)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: err.error?.message || 'API error' }),
      };
    }

    const data = await response.json();
    const text = data.content.map(c => c.text || '').join('').trim();

    // Parse and validate JSON from Claude
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse Claude response');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
