const { shell, session } = require('electron');
const { app } = require('electron'); // for getting cookies from session

// --- Constants & Utils ---

const hostsWithCookiesAccess = [
  /^(?:.*\.)?ee3\.me$/,
  /^(?:.*\.)?rips\.cc$/,
  /^(?:.*\.)?m4ufree\.(?:tv|to|pw)$/,
  /^(?:.*\.)?goojara\.to$/,
  /^(?:.*\.)?levidia\.ch$/,
  /^(?:.*\.)?wootly\.ch$/,
  /^(?:.*\.)?multimovies\.(?:sbs|online|cloud)$/,
];

function canAccessCookies(host) {
  return hostsWithCookiesAccess.some((regex) => regex.test(host));
}

const modifiableResponseHeaders = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-disposition',
];

// --- Dynamic Rules State ---
// Map<ruleId, RuleObject>
const activeRules = new Map();

function updateRule(rule) {
  // If rule has removeRuleIds logic (not passed here usually, but extensions do), handle it?
  // The extension sends the whole rule object to setDynamicRules.
  // We just store it.
  activeRules.set(rule.ruleId, rule);
}

function removeRule(ruleId) {
  activeRules.delete(ruleId);
}

function getMakeFullUrl(url, body) {
  // extension/src/utils/fetcher.ts
  
  let leftSide = (body && body.baseUrl) ? body.baseUrl : '';
  let rightSide = url;

  if (leftSide.length > 0 && !leftSide.endsWith('/')) leftSide += '/';
  if (rightSide.startsWith('/')) rightSide = rightSide.slice(1);

  const fullUrl = leftSide + rightSide;
  
  const u = new URL(fullUrl);
  
  if (body && body.query) {
      Object.entries(body.query).forEach(([key, val]) => {
        u.searchParams.append(key, val);
      });
  }
  return u.toString();
}

function mapBodyToFetchBody(body, bodyType) {
  if (bodyType === 'FormData') {
    const formData = new FormData();
    if (Array.isArray(body)) {
        body.forEach(([key, value]) => {
            formData.append(key, value.toString());
        });
    } else if (typeof body === 'object') {
         Object.entries(body).forEach(([key, value]) => {
            formData.append(key, value.toString());
        });
    }
    return formData;
  }
  if (bodyType === 'URLSearchParams') {
    return new URLSearchParams(body);
  }
  if (bodyType === 'object') {
    return JSON.stringify(body);
  }
  if (bodyType === 'string') {
    return body;
  }
  return body;
}

// --- IPC Handlers ---

const handlers = {
  async hello() {
    return {
      success: true,
      version: '1.3.7', // Match extension version
      type: 'desktop', // maybe useful?
      allowed: true,
      hasPermission: true
    };
  },

  async openPage(body) {
    if (body && body.page) {
      // In extension this opens internal pages.
      // But the app might ask to open external URLs?
      // Check usages. content/movie-web.ts says relayMessage({ name: 'openPage' })
      // Usually used for "PermissionGrant" etc.
      // If body.page is a URL or external, open it.
      // For now, log it.
      console.log('Request to openPage:', body);
    }
    return { success: true };
  },

  async prepareStream(body) {
    try {
      // body contains ruleId, targetDomains, requestHeaders, responseHeaders
      if (!body) throw new Error('No body');
      
      // Filter response headers like extension does
      const filteredResponseHeaders = {};
      if (body.responseHeaders) {
        Object.keys(body.responseHeaders).forEach(key => {
          if (modifiableResponseHeaders.includes(key.toLowerCase())) {
            filteredResponseHeaders[key] = body.responseHeaders[key];
          }
        });
      }
      body.responseHeaders = filteredResponseHeaders;

      updateRule(body);
      return { success: true };
    } catch (err) {
      console.error('prepareStream error:', err);
      return { success: false, error: err.message };
    }
  },

  async makeRequest(body) {
    try {
        // body: { url, method, headers, body, bodyType }
        if (!body.url) throw new Error('No url');

        const url = getMakeFullUrl(body.url, body);
        const method = body.method || 'GET';
        const headers = body.headers || {};
        
        // In Node fetch, we can just pass headers.
        // We do NOT set dynamic rules for the Main Process fetch because we are not a browser.
        // We can bypass CORS naturally.
        
        // Handle Cookie header if needed? 
        // Electron session handles cookies automatically if we don't interfere.
        // But if the request explicitly provides a 'Cookie' header in `headers`, use it.
        
        const fetchOptions = {
            method,
            headers,
            body: mapBodyToFetchBody(body.body, body.bodyType)
        };
        
        // Remove User-Agent if not set, or let it be default?
        // Some sites check UA.
        
        const response = await fetch(url, fetchOptions);
        
        const contentType = response.headers.get('content-type');
        const responseBody = contentType && contentType.includes('application/json') 
            ? await response.json() 
            : await response.text();
            
        // Cookies
        // extension uses chrome.cookies.getAll({ url: response.url })
        // We use session.defaultSession.cookies.get({ url: response.url })
        const cookies = await session.defaultSession.cookies.get({ url: response.url });
        
        // Construct response headers object
        const responseHeaders = {};
        response.headers.forEach((val, key) => {
            responseHeaders[key] = val;
        });

        // Add Set-Cookie mock if allowed
        const hostname = new URL(url).hostname;
        if (canAccessCookies(hostname)) {
             responseHeaders['Set-Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join(', ');
             responseHeaders['Access-Control-Allow-Credentials'] = 'true';
        }

        return {
            success: true,
            response: {
                statusCode: response.status,
                headers: responseHeaders,
                finalUrl: response.url,
                body: responseBody
            }
        };

    } catch (err) {
        console.error('makeRequest error:', err);
        return { success: false, error: err.message };
    }
  }
};

// --- Network Interceptor ---

function setupInterceptors(sess) {
  const filter = { urls: ['<all_urls>'] };

  sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    let requestHeaders = details.requestHeaders;
    let modified = false;

    // Check all active rules
    for (const rule of activeRules.values()) {
       // Check domain match
       // rule.targetDomains (array of strings)
       // rule.targetRegex (string)
       
       let match = false;
       const urlObj = new URL(details.url);
       const hostname = urlObj.hostname;

       if (rule.targetDomains && rule.targetDomains.some(d => hostname.includes(d))) {
           match = true;
       }
       if (rule.targetRegex && new RegExp(rule.targetRegex).test(details.url)) {
           match = true;
       }

       if (match) {
           // Apply requestHeaders
           if (rule.requestHeaders) {
               Object.entries(rule.requestHeaders).forEach(([name, value]) => {
                   requestHeaders[name] = value;
                   modified = true;
               });
           }
       }
    }
    
    callback({ requestHeaders: requestHeaders });
  });

  sess.webRequest.onHeadersReceived(filter, (details, callback) => {
    let responseHeaders = { ...details.responseHeaders }; // Clone headers
    
    // Check all active rules
    let match = false;
    let ruleMatches = [];

    for (const rule of activeRules.values()) {
        let ruleMatch = false;
        try {
            const urlObj = new URL(details.url);
            const hostname = urlObj.hostname;
    
            if (rule.targetDomains && rule.targetDomains.some(d => hostname.includes(d))) {
                ruleMatch = true;
            }
            if (rule.targetRegex && new RegExp(rule.targetRegex).test(details.url)) {
                ruleMatch = true;
            }
        } catch(e) {}
 
        if (ruleMatch) {
            match = true;
            ruleMatches.push(rule);
        }
    }
     
    if (match) {
        // Helper to remove header case-insensitively
        const removeHeader = (name) => {
            const lowerName = name.toLowerCase();
            Object.keys(responseHeaders).forEach(key => {
                if (key.toLowerCase() === lowerName) {
                    delete responseHeaders[key];
                }
            });
        };

        // Apply responseHeaders from rules
        ruleMatches.forEach(rule => {
             if (rule.responseHeaders) {
                 Object.entries(rule.responseHeaders).forEach(([name, value]) => {
                     removeHeader(name);
                     responseHeaders[name] = [value]; 
                 });
             }
        });
         
        // Always add/overwrite CORS if rule matches
        removeHeader('Access-Control-Allow-Origin');
        removeHeader('Access-Control-Allow-Methods');
        removeHeader('Access-Control-Allow-Headers');
        removeHeader('Access-Control-Allow-Credentials');

        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, PATCH, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];
        // Note: Access-Control-Allow-Credentials cannot be true if Origin is * in strict browsers,
        // but often extensions force this.
        // If we want credentials, we usually need to echo the Origin.
        // The extension sets '*' for Origin.
        // Let's check extension logic:
        // responseHeaders: [ { header: 'Access-Control-Allow-Origin', value: '*' }, ... ]
        // So we stick to '*'
    }
     
    callback({ responseHeaders: responseHeaders });
  });
}

module.exports = {
    handlers,
    setupInterceptors
};
