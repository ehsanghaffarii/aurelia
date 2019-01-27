System.register('fetchClient', ['@aurelia/kernel', '@aurelia/runtime'], function (exports, module) {
  'use strict';
  var PLATFORM, DOM, IDOM;
  return {
    setters: [function (module) {
      PLATFORM = module.PLATFORM;
    }, function (module) {
      DOM = module.DOM;
      IDOM = module.IDOM;
    }],
    execute: function () {

      exports('json', json);

      /**
      * Serialize an object to JSON. Useful for easily creating JSON fetch request bodies.
      *
      * @param body The object to be serialized to JSON.
      * @param replacer The JSON.stringify replacer used when serializing.
      * @returns A JSON string.
      */
      function json(body, replacer) {
          return JSON.stringify((body !== undefined ? body : {}), replacer);
      }

      const retryStrategy = exports('retryStrategy', {
          fixed: 0,
          incremental: 1,
          exponential: 2,
          random: 3
      });
      const defaultRetryConfig = {
          maxRetries: 3,
          interval: 1000,
          strategy: retryStrategy.fixed
      };
      class RetryInterceptor {
          constructor(retryConfig) {
              this.retryConfig = Object.assign({}, defaultRetryConfig, (retryConfig || {}));
              if (this.retryConfig.strategy === retryStrategy.exponential &&
                  this.retryConfig.interval <= 1000) {
                  throw new Error('An interval less than or equal to 1 second is not allowed when using the exponential retry strategy');
              }
          }
          request(request) {
              const $r = request;
              if (!$r.retryConfig) {
                  $r.retryConfig = Object.assign({}, this.retryConfig);
                  $r.retryConfig.counter = 0;
              }
              // do this on every request
              $r.retryConfig.requestClone = request.clone();
              return request;
          }
          response(response, request) {
              // retry was successful, so clean up after ourselves
              delete request.retryConfig;
              return response;
          }
          responseError(error, request, httpClient) {
              const { retryConfig } = request;
              const { requestClone } = retryConfig;
              return Promise.resolve().then(() => {
                  if (retryConfig.counter < retryConfig.maxRetries) {
                      const result = retryConfig.doRetry ? retryConfig.doRetry(error, request) : true;
                      return Promise.resolve(result).then(doRetry => {
                          if (doRetry) {
                              retryConfig.counter++;
                              return new Promise(resolve => PLATFORM.global.setTimeout(resolve, calculateDelay(retryConfig) || 0))
                                  .then(() => {
                                  const newRequest = requestClone.clone();
                                  if (typeof (retryConfig.beforeRetry) === 'function') {
                                      return retryConfig.beforeRetry(newRequest, httpClient);
                                  }
                                  return newRequest;
                              })
                                  .then(newRequest => {
                                  return httpClient.fetch(Object.assign({}, newRequest, { retryConfig }));
                              });
                          }
                          // no more retries, so clean up
                          delete request.retryConfig;
                          throw error;
                      });
                  }
                  // no more retries, so clean up
                  delete request.retryConfig;
                  throw error;
              });
          }
      } exports('RetryInterceptor', RetryInterceptor);
      function calculateDelay(retryConfig) {
          const { interval, strategy, minRandomInterval, maxRandomInterval, counter } = retryConfig;
          if (typeof (strategy) === 'function') {
              return retryConfig.strategy(counter);
          }
          switch (strategy) {
              case (retryStrategy.fixed):
                  return retryStrategies[retryStrategy.fixed](interval);
              case (retryStrategy.incremental):
                  return retryStrategies[retryStrategy.incremental](counter, interval);
              case (retryStrategy.exponential):
                  return retryStrategies[retryStrategy.exponential](counter, interval);
              case (retryStrategy.random):
                  return retryStrategies[retryStrategy.random](counter, interval, minRandomInterval, maxRandomInterval);
              default:
                  throw new Error('Unrecognized retry strategy');
          }
      }
      const retryStrategies = [
          // fixed
          interval => interval,
          // incremental
          (retryCount, interval) => interval * retryCount,
          // exponential
          (retryCount, interval) => retryCount === 1 ? interval : Math.pow(interval, retryCount) / 1000,
          // random
          (retryCount, interval, minRandomInterval = 0, maxRandomInterval = 60000) => {
              return Math.random() * (maxRandomInterval - minRandomInterval) + minRandomInterval;
          }
      ];

      /**
       * A class for configuring HttpClients.
       */
      class HttpClientConfiguration {
          constructor() {
              /**
               * The base URL to be prepended to each Request's url before sending.
               */
              this.baseUrl = '';
              /**
               * Default values to apply to init objects when creating Requests. Note that
               * defaults cannot be applied when Request objects are manually created because
               * Request provides its own defaults and discards the original init object.
               * See also https://developer.mozilla.org/en-US/docs/Web/API/Request/Request
               */
              this.defaults = {};
              /**
               * Interceptors to be added to the HttpClient.
               */
              this.interceptors = [];
          }
          /**
           * Sets the baseUrl.
           *
           * @param baseUrl The base URL.
           * @returns The chainable instance of this configuration object.
           * @chainable
           */
          withBaseUrl(baseUrl) {
              this.baseUrl = baseUrl;
              return this;
          }
          /**
           * Sets the defaults.
           *
           * @param defaults The defaults.
           * @returns The chainable instance of this configuration object.
           * @chainable
           */
          withDefaults(defaults) {
              this.defaults = defaults;
              return this;
          }
          /**
           * Adds an interceptor to be run on all requests or responses.
           *
           * @param interceptor An object with request, requestError,
           * response, or responseError methods. request and requestError act as
           * resolve and reject handlers for the Request before it is sent.
           * response and responseError act as resolve and reject handlers for
           * the Response after it has been received.
           * @returns The chainable instance of this configuration object.
           * @chainable
           */
          withInterceptor(interceptor) {
              this.interceptors.push(interceptor);
              return this;
          }
          /**
           * Applies a configuration that addresses common application needs, including
           * configuring same-origin credentials, and using rejectErrorResponses.
           * @returns The chainable instance of this configuration object.
           * @chainable
           */
          useStandardConfiguration() {
              const standardConfig = { credentials: 'same-origin' };
              Object.assign(this.defaults, standardConfig, this.defaults);
              return this.rejectErrorResponses();
          }
          /**
           * Causes Responses whose status codes fall outside the range 200-299 to reject.
           * The fetch API only rejects on network errors or other conditions that prevent
           * the request from completing, meaning consumers must inspect Response.ok in the
           * Promise continuation to determine if the server responded with a success code.
           * This method adds a response interceptor that causes Responses with error codes
           * to be rejected, which is common behavior in HTTP client libraries.
           * @returns The chainable instance of this configuration object.
           * @chainable
           */
          rejectErrorResponses() {
              return this.withInterceptor({ response: rejectOnError });
          }
          withRetry(config) {
              const interceptor = new RetryInterceptor(config);
              return this.withInterceptor(interceptor);
          }
      } exports('HttpClientConfiguration', HttpClientConfiguration);
      function rejectOnError(response) {
          if (!response.ok) {
              throw response;
          }
          return response;
      }

      const absoluteUrlRegexp = /^([a-z][a-z0-9+\-.]*:)?\/\//i;
      /**
       * An HTTP client based on the Fetch API.
       */
      class HttpClient {
          /**
           * Creates an instance of HttpClient.
           */
          constructor(dom) {
              if (dom.window.fetch === undefined) {
                  // tslint:disable-next-line:max-line-length
                  throw new Error('HttpClient requires a Fetch API implementation, but the current environment doesn\'t support it. You may need to load a polyfill such as https://github.com/github/fetch');
              }
              this.dom = dom;
              this.activeRequestCount = 0;
              this.isRequesting = false;
              this.isConfigured = false;
              this.baseUrl = '';
              this.defaults = null;
              this.interceptors = [];
          }
          /**
           * Configure this client with default settings to be used by all requests.
           *
           * @param config A configuration object, or a function that takes a config
           * object and configures it.
           * @returns The chainable instance of this HttpClient.
           * @chainable
           */
          configure(config) {
              let normalizedConfig;
              if (typeof config === 'object') {
                  normalizedConfig = { defaults: config };
              }
              else if (typeof config === 'function') {
                  normalizedConfig = new HttpClientConfiguration();
                  normalizedConfig.baseUrl = this.baseUrl;
                  normalizedConfig.defaults = Object.assign({}, this.defaults);
                  normalizedConfig.interceptors = this.interceptors;
                  const c = config(normalizedConfig);
                  //tslint:disable-next-line no-any
                  if (HttpClientConfiguration.prototype.isPrototypeOf(c)) {
                      //tslint:disable-next-line no-any
                      normalizedConfig = c;
                  }
              }
              else {
                  throw new Error('invalid config');
              }
              const defaults = normalizedConfig.defaults;
              if (defaults && Headers.prototype.isPrototypeOf(defaults.headers)) {
                  // Headers instances are not iterable in all browsers. Require a plain
                  // object here to allow default headers to be merged into request headers.
                  throw new Error('Default headers must be a plain object.');
              }
              const interceptors = normalizedConfig.interceptors;
              if (interceptors && interceptors.length) {
                  // find if there is a RetryInterceptor
                  if (interceptors.filter(x => RetryInterceptor.prototype.isPrototypeOf(x)).length > 1) {
                      throw new Error('Only one RetryInterceptor is allowed.');
                  }
                  const retryInterceptorIndex = interceptors.findIndex(x => RetryInterceptor.prototype.isPrototypeOf(x));
                  if (retryInterceptorIndex >= 0 && retryInterceptorIndex !== interceptors.length - 1) {
                      throw new Error('The retry interceptor must be the last interceptor defined.');
                  }
              }
              this.baseUrl = normalizedConfig.baseUrl;
              this.defaults = defaults;
              this.interceptors = normalizedConfig.interceptors || [];
              this.isConfigured = true;
              return this;
          }
          /**
           * Starts the process of fetching a resource. Default configuration parameters
           * will be applied to the Request. The constructed Request will be passed to
           * registered request interceptors before being sent. The Response will be passed
           * to registered Response interceptors before it is returned.
           *
           * See also https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          fetch(input, init) {
              this.trackRequestStart();
              let request = this.buildRequest(input, init);
              return this.processRequest(request, this.interceptors).then(result => {
                  let response = null;
                  if (Response.prototype.isPrototypeOf(result)) {
                      response = Promise.resolve(result);
                  }
                  else if (Request.prototype.isPrototypeOf(result)) {
                      request = result;
                      response = fetch(result);
                  }
                  else {
                      // tslint:disable-next-line:max-line-length
                      throw new Error(`An invalid result was returned by the interceptor chain. Expected a Request or Response instance, but got [${result}]`);
                  }
                  return this.processResponse(response, this.interceptors, request);
              })
                  .then(result => {
                  if (Request.prototype.isPrototypeOf(result)) {
                      return this.fetch(result);
                  }
                  return result;
              })
                  .then(result => {
                  this.trackRequestEnd();
                  return result;
              }, error => {
                  this.trackRequestEnd();
                  throw error;
              });
          }
          buildRequest(input, init) {
              const defaults = this.defaults || {};
              let request;
              //tslint:disable-next-line no-any
              let body;
              let requestContentType;
              const parsedDefaultHeaders = parseHeaderValues(defaults.headers);
              if (Request.prototype.isPrototypeOf(input)) {
                  request = input;
                  requestContentType = new Headers(request.headers).get('Content-Type');
              }
              else {
                  if (!init) {
                      init = {};
                  }
                  body = init.body;
                  const bodyObj = body ? { body } : null;
                  const requestInit = Object.assign({}, defaults, { headers: {} }, init, bodyObj);
                  requestContentType = new Headers(requestInit.headers).get('Content-Type');
                  request = new Request(getRequestUrl(this.baseUrl, input), requestInit);
              }
              if (!requestContentType) {
                  if (new Headers(parsedDefaultHeaders).has('content-type')) {
                      request.headers.set('Content-Type', new Headers(parsedDefaultHeaders).get('content-type'));
                  }
                  else if (body && isJSON(body)) {
                      request.headers.set('Content-Type', 'application/json');
                  }
              }
              setDefaultHeaders(request.headers, parsedDefaultHeaders);
              if (body && Blob.prototype.isPrototypeOf(body) && body.type) {
                  // work around bug in IE & Edge where the Blob type is ignored in the request
                  // https://connect.microsoft.com/IE/feedback/details/2136163
                  request.headers.set('Content-Type', body.type);
              }
              return request;
          }
          /**
           * Calls fetch as a GET request.
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          get(input, init) {
              return this.fetch(input, init);
          }
          /**
           * Calls fetch with request method set to POST.
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param body The body of the request.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          //tslint:disable-next-line no-any
          post(input, body, init) {
              return this.callFetch(input, body, init, 'POST');
          }
          /**
           * Calls fetch with request method set to PUT.
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param body The body of the request.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          //tslint:disable-next-line no-any
          put(input, body, init) {
              return this.callFetch(input, body, init, 'PUT');
          }
          /**
           * Calls fetch with request method set to PATCH.
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param body The body of the request.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          //tslint:disable-next-line no-any
          patch(input, body, init) {
              return this.callFetch(input, body, init, 'PATCH');
          }
          /**
           * Calls fetch with request method set to DELETE.
           *
           * @param input The resource that you wish to fetch. Either a
           * Request object, or a string containing the URL of the resource.
           * @param body The body of the request.
           * @param init An options object containing settings to be applied to
           * the Request.
           * @returns A Promise for the Response from the fetch request.
           */
          //tslint:disable-next-line no-any
          delete(input, body, init) {
              return this.callFetch(input, body, init, 'DELETE');
          }
          trackRequestStart() {
              this.isRequesting = !!(++this.activeRequestCount);
              if (this.isRequesting) {
                  const evt = DOM.createCustomEvent('aurelia-fetch-client-request-started', { bubbles: true, cancelable: true });
                  PLATFORM.setTimeout(() => DOM.dispatchEvent(evt), 1);
              }
          }
          trackRequestEnd() {
              this.isRequesting = !!(--this.activeRequestCount);
              if (!this.isRequesting) {
                  const evt = DOM.createCustomEvent('aurelia-fetch-client-requests-drained', { bubbles: true, cancelable: true });
                  PLATFORM.setTimeout(() => DOM.dispatchEvent(evt), 1);
              }
          }
          processRequest(request, interceptors) {
              return this.applyInterceptors(request, interceptors, 'request', 'requestError', this);
          }
          processResponse(response, interceptors, request) {
              return this.applyInterceptors(response, interceptors, 'response', 'responseError', request, this);
          }
          // tslint:disable-next-line:max-line-length
          applyInterceptors(input, interceptors, successName, errorName, ...interceptorArgs) {
              return (interceptors || [])
                  .reduce((chain, interceptor) => {
                  const successHandler = interceptor[successName];
                  const errorHandler = interceptor[errorName];
                  return chain.then(successHandler && (value => successHandler.call(interceptor, value, ...interceptorArgs)) || identity, errorHandler && (reason => errorHandler.call(interceptor, reason, ...interceptorArgs)) || thrower);
              }, Promise.resolve(input));
          }
          callFetch(input, body, init, method) {
              if (!init) {
                  init = {};
              }
              init.method = method;
              if (body) {
                  init.body = body;
              }
              return this.fetch(input, init);
          }
      } exports('HttpClient', HttpClient);
      HttpClient.inject = [IDOM];
      function parseHeaderValues(headers) {
          const parsedHeaders = {};
          for (const name in headers || {}) {
              if (headers.hasOwnProperty(name)) {
                  parsedHeaders[name] = (typeof headers[name] === 'function') ? headers[name]() : headers[name];
              }
          }
          return parsedHeaders;
      }
      function getRequestUrl(baseUrl, url) {
          if (absoluteUrlRegexp.test(url)) {
              return url;
          }
          return (baseUrl || '') + url;
      }
      function setDefaultHeaders(headers, defaultHeaders) {
          for (const name in defaultHeaders || {}) {
              if (defaultHeaders.hasOwnProperty(name) && !headers.has(name)) {
                  headers.set(name, defaultHeaders[name]);
              }
          }
      }
      function isJSON(str) {
          try {
              JSON.parse(str);
          }
          catch (err) {
              return false;
          }
          return true;
      }
      function identity(x) {
          return x;
      }
      function thrower(x) {
          throw x;
      }

    }
  };
});
//# sourceMappingURL=index.system.js.map
