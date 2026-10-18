const express = require('express');
const { MATERIAL_FINALIZE_JSON_LIMIT } = require('./materialTextLimits');
const parse = express.json({ limit: MATERIAL_FINALIZE_JSON_LIMIT });
// Mounted before the default JSON parser, for this exact endpoint only.
function materialFinalizeBody(req, res, next) {
  parse(req, res, error => {
    if (!error) return next();
    return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false,
      message: error.type === 'entity.too.large'
        ? 'The reviewed text exceeds the maximum save request size. Please shorten the material.'
        : 'The material save request could not be read. Please try again.' });
  });
}
module.exports = { materialFinalizeBody };
