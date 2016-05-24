'use strict';

module.exports = {
  name: 'ember-cli-string-module-loader',

  init: function() {
    this.treePaths['vendor'] = 'lib';
  },

  included: function() {
    this.app.import('vendor/loader/loader.js', {
      prepend: true
    });
  }
};
