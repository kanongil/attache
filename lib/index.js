// Load modules

var Hoek = require('hoek');
var Joi = require('joi');
var Consul = require('./consul');


// Declare internals

var internals = {
    defaults: {
        service: {
            name: 'hapi',
            check: {
                path: '/_health',
                interval: '5s',
                startHealthy: true
            }
        },
        consul: {}
    }
};


internals.schema = Joi.object({
    service: Joi.object({
        name: Joi.string().description('Service name, as reported to Consul'),
        check: Joi.object({
            path: Joi.string().allow(false),
            ttl: Joi.alternatives().try(Joi.number().integer().min(1000), Joi.string()).description('Maximum check-in interval').unit('ms'),
            interval: Joi.alternatives().try(Joi.number().integer().min(1000), Joi.string()).description('Check interval').unit('ms'),
            startHealthy: Joi.boolean().description('Set an initial "passing" status')
        })
    }),
    consul: Joi.object({
        host: [Joi.string().ip(), Joi.string().hostname()],
        port: Joi.number().integer().min(0).max(65535),
        secure: Joi.boolean(),
        ca: Joi.array().items(Joi.string(), Joi.binary()).single()
    })
});

exports.register = function (server, options, next) {

    Joi.assert(options, internals.schema, 'Invalid plugin options');
    var settings = Joi.validate(Hoek.applyToDefaults(internals.defaults, options), internals.schema).value;

    var consul = new Consul(server, settings.service, settings.consul);

    server.decorate('server', 'consul', consul);

    server.ext('onPostStart', function (server1, next1) {

        return consul.register(next1);
    });

    server.ext('onPreStop', function (server1, next1) {

        return consul.deregister(function (err) {

            err = err;      // Don't return de-registration errors

            return next1();
        });
    });

    return next();
};


exports.register.attributes = {
    pkg: require('../package.json')
};
