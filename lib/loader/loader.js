var loader, define, requireModule, require, requirejs, defineStringModule, defineInitializerRegistry;

(function(global) {
  'use strict';
  // Save off the original values of these globals, so we can restore them if someone asks us to
  var oldGlobals = {
    loader: loader,
    define: define,
    requireModule: requireModule,
    require: require,
    requirejs: requirejs,
    defineStringModule: defineStringModule,
    defineInitializerRegistry: defineInitializerRegistry
  };

  loader = {
    noConflict: function(aliases) {
      var oldName, newName;

      for (oldName in aliases) {
        if (aliases.hasOwnProperty(oldName)) {
          if (oldGlobals.hasOwnProperty(oldName)) {
            newName = aliases[oldName];

            global[newName] = global[oldName];
            global[oldName] = oldGlobals[oldName];
          }
        }
      }
    }
  };

  var _isArray;
  if (!Array.isArray) {
    _isArray = function (x) {
      return Object.prototype.toString.call(x) === '[object Array]';
    };
  } else {
    _isArray = Array.isArray;
  }

  var registry = {};
  var stringRegistry = {};
  var initializerRegistry = [];
  var seen = {};
  var stats ={};
  var uuid = 0;

  function unsupportedModule(length) {
    throw new Error('an unsupported module was defined, expected `define(name, deps, module)` instead got: `' +
                    length + '` arguments to define`');
  }

  var defaultDeps = ['require', 'exports', 'module'];

  function Module(name, deps, callback, alias) {
    stats.modules++;
    this.id        = uuid++;
    this.name      = name;
    this.deps      = !deps.length && callback.length ? defaultDeps : deps;
    this.module    = { exports: {} };
    this.callback  = callback;
    this.finalized = false;
    this.hasExportsAsDep = false;
    this.isAlias = alias;
    this.reified = new Array(deps.length);
    this._foundDeps = false;
    this.isPending = false;
  }

  Module.prototype.makeDefaultExport = function() {
    var exports = this.module.exports;
    if (exports !== null &&
        (typeof exports === 'object' || typeof exports === 'function') &&
          exports['default'] === undefined) {
      exports['default'] = exports;
    }
  };

  Module.prototype.exports = function() {
    if (this.finalized) {
      return this.module.exports;
    }
    stats.exports++;
    this.finalized = true;
    this.isPending = false;

    if (loader.wrapModules) {
      this.callback = loader.wrapModules(this.name, this.callback);
    }

    this.reify();
    var result = this.callback.apply(this, this.reified);
    if (!(this.hasExportsAsDep && result === undefined)) {
      this.module.exports = result;
    }
    this.makeDefaultExport();
    return this.module.exports;
  };

  Module.prototype.unsee = function() {
    this.finalized = false;
    this._foundDeps = false;
    this.isPending = false;
    this.module = { exports: {}};
  };

  Module.prototype.reify = function() {
    stats.reify++;
    var reified = this.reified;
    for (var i = 0; i < reified.length; i++) {
      var mod = reified[i];
      reified[i] = mod.exports ? mod.exports : mod.module.exports();
    }
  };

  Module.prototype.findDeps = function(pending) {
    if (this._foundDeps) {
      return;
    }

    stats.findDeps++;
    this._foundDeps = true;
    this.isPending = true;

    var deps = this.deps;

    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      var entry = this.reified[i] = { exports: undefined, module: undefined };

      if (dep === 'exports') {
        this.hasExportsAsDep = true;
        entry.exports = this.module.exports;
      } else if (dep === 'require') {
        entry.exports = this.makeRequire();
      } else if (dep === 'module') {
        entry.exports = this.module;
      } else {
        entry.module = findModule(resolve(dep, this.name), this.name, pending);
      }
    }
  }

  Module.prototype.makeRequire = function() {
    var name = this.name;
    var r = function(dep) {
      return require(resolve(dep, name));
    };
    r['default'] = r;
    r.has = function(dep) {
      return has(resolve(dep, name));
    }
    return r;
  };

  function createModuleFromString(name, deps, params, body) {
    var callback = new Function(params, body);
    var mod = new Module(name, deps, callback, false);

    return mod;
  }

  defineStringModule = function(reg) {
    stringRegistry = reg;

    requirejs.stringRegistry = stringRegistry;
  };

  defineInitializerRegistry = function(initializerReg) {
    initializerRegistry = initializerReg;
    requirejs.intializerEntries = initializerRegistry;
  };

  define = function(name, deps, callback) {
    stats.define++;
    if (arguments.length < 2) {
      unsupportedModule(arguments.length);
    }

    if (!_isArray(deps)) {
      callback = deps;
      deps     =  [];
    }

    if (callback instanceof Alias) {
      registry[name] = new Module(callback.name, deps, callback, true);
    } else {
      registry[name] = new Module(name, deps, callback, false);
    }
  };

  // we don't support all of AMD
  // define.amd = {};
  // we will support petals...
  define.petal = { };

  function Alias(path) {
    this.name = path;
  }

  define.alias = function(path) {
    return new Alias(path);
  };

  function missingModule(name, referrer) {
    throw new Error('Could not find module `' + name + '` imported from `' + referrer + '`');
  }

  requirejs = require = requireModule = function(name) {
    stats.require++;
    var pending = [];
    var mod = findModule(name, '(require)', pending);

    for (var i = pending.length - 1; i >= 0; i--) {
      pending[i].exports();
    }

    return mod.module.exports;
  };

  function findModule(name, referrer, pending) {
    stats.findModule++;
    var mod;
    if (stringRegistry[name]) {
      // this module is never evaluated, therefore create an instance for it and let's evaluate in a DFS fashion
      // this is the default export value, this is updated when the function is
      // evaluated (by reference principle) or using the result of what the function returns
      // additionally we make it a default export if it isn't one
      var stringModSpec = JSON.parse(stringRegistry[name]),
          body = stringModSpec.body,
          params = stringModSpec.params,
          deps = stringModSpec.imports;

      mod = createModuleFromString(name, deps, params, body);
      // delete the string registry entry and replace with module reference
      delete stringRegistry[name];
      registry[name] = mod;
    } else {
      mod = registry[name] || registry[name + '/index'];

      while (mod && mod.isAlias) {
        mod = registry[mod.name];
      }
    }
    if (!mod) { missingModule(name, referrer); }

    if (pending && !mod.finalized && !mod.isPending) {
      mod.findDeps(pending);
      pending.push(mod);
    }

    return mod;
  }

  function resolve(child, name) {
    stats.resolve++;
    if (child.charAt(0) !== '.') { return child; }
    stats.resolveRelative++;

    var parts = child.split('/');
    var nameParts = name.split('/');
    var parentBase = nameParts.slice(0, -1);

    for (var i = 0, l = parts.length; i < l; i++) {
      var part = parts[i];

      if (part === '..') {
        if (parentBase.length === 0) {
          throw new Error('Cannot access parent module of root');
        }
        parentBase.pop();
      } else if (part === '.') {
        continue;
      } else { parentBase.push(part); }
    }

    return parentBase.join('/');
  }

  function has(name) {
    return !!(registry[name] || registry[name + '/index'] || stringRegistry[name]);
  }

  function moduleNames() {
    var moduleNames = [];
    var modules = Object.keys(registry);
    var stringModules = Object.keys(stringRegistry);
    moduleNames.push.apply(modules, stringModules);
    return moduleNames;
  }

  requirejs.entries = requirejs._eak_seen = registry;
  requirejs._stats = stats;
  requirejs.stringRegistry = stringRegistry;
  requirejs.intializerEntries = initializerRegistry;
  requirejs.has = has;
  requirejs.moduleNames = moduleNames;
  requirejs.unsee = function(moduleName) {
    findModule(moduleName, '(unsee)', false).unsee();
  };

  requirejs.clear = function() {
    requirejs.entries = requirejs._eak_seen = registry = {};
    requirejs.stringRegistry = {};
    requirejs.initializerRegistry = initializerRegistry = [];
    seen = {};
    resetStats();
  };

  function resetStats() {
    stats = {
      define: 0,
      require: 0,
      reify: 0,
      findDeps: 0,
      modules: 0,
      exports: 0,
      resolve: 0,
      resolveRelative: 0,
      findModule: 0,
    };
    requirejs._stats = stats;
  }
  resetStats();

  // prime
  define('foo',      function() {});
  define('foo/bar',  [], function() {});
  define('foo/asdf', ['module', 'exports', 'require'], function(module, exports, require) {
    if (require.has('foo/bar')) {
      require('foo/bar');
    }
  });
  define('foo/baz',  [], define.alias('foo'));
  define('foo/quz',  define.alias('foo'));
  define('foo/bar',  ['foo', './quz', './baz', './asdf', './bar', '../foo'], function() {});
  define('foo/main', ['foo/bar'], function() {});

  require('foo/main');
  require.unsee('foo/bar');

  requirejs.clear();

  if (typeof module !== 'undefined') {
    module.exports = {
      require: require,
      define: define,
      defineStringModule: defineStringModule,
      defineInitializerRegistry: defineInitializerRegistry
    };
  }
})(this);
