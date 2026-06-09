/**
 * odds.js — endpoint legacy păstrat pentru compatibilitate
 * Redirecționează spre scan.js
 */
const scanHandler = require("./scan.js");

module.exports = async function handler(req, res) {
  return scanHandler(req, res);
};
