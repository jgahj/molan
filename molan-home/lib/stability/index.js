'use strict';

const errorCatalog = require('./error-catalog');
const circuitBreaker = require('./circuit-breaker');
const concurrency = require('./concurrency');
const deadline = require('./deadline');

module.exports = {
  ...errorCatalog,
  ...circuitBreaker,
  ...concurrency,
  ...deadline
};
