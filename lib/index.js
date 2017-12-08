'use strict';

// Load modules

const Bounce = require('bounce');
const Hoek = require('hoek');
const Joi = require('joi');

const Consul = require('./consul');


// Declare internals

const internals = {
    defaults: {
        service: {
            name: 'hapi',
            check: {
                path: '/_health',
                interval: '5s',
                deregisterAfter: '120m',
                startHealthy: true
            }
        },
        retryStrategy: null,
        lowProfile: false,
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
            deregisterAfter: Joi.alternatives().try(Joi.number().integer().min(1000), Joi.string()).allow(false).description('Auto de-register critical service').unit('ms'),
            startHealthy: Joi.boolean().description('Set an initial "passing" status')
        })
    }),
    retryStrategy: Joi.func().description('Custom retry strategy'),
    lowProfile: Joi.boolean().description('Allow server to start without a succesful register'),
    consul: Joi.object({
        host: [Joi.string().ip(), Joi.string().hostname()],
        port: Joi.number().integer().min(0).max(65535),
        secure: Joi.boolean(),
        ca: Joi.array().items(Joi.string(), Joi.binary()).single()
    })
});


internals.retryAction = async function (consul, retryStrategy, state) {

    try {
        ++state.attempt;
        return await consul[state.action]();
    }
    catch (err) {
        if (retryStrategy) {
            Bounce.rethrow(err, 'system');
            const delay = await retryStrategy(consul, err, state);
            if (delay > 0 || delay === 0) {
                await Hoek.wait(delay);
                return internals.retryAction(consul, retryStrategy, state);
            }
        }
        throw err;
    }
};


exports.plugin = {
    pkg: require('../package.json'),

    register(server, options) {

        Joi.assert(options, internals.schema, 'Invalid plugin options');
        const settings = Joi.validate(Hoek.applyToDefaults(internals.defaults, options), internals.schema).value;

        const consul = new Consul(server, settings.service, settings.consul);

        server.decorate('server', 'consul', consul);

        const register = () => {

            return internals.retryAction(consul, settings.retryStrategy, { action: 'register', attempt: 0, startTime: Date.now() });
        };

        server.ext('onPostStart', () => {

            if (settings.lowProfile) {
                Bounce.background(register);
                return;
            }

            return register();
        });

        server.ext('onPreStop', async () => {

            try {
                return await internals.retryAction(consul, settings.retryStrategy, { action: 'deregister', attempt: 0, startTime: Date.now() });
            }
            catch (err) {
                Bounce.rethrow(err, 'system');
            }
        });
    }
};
