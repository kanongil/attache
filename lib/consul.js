'use strict';

// Load modules

const Consul = require('consul');
const Hoek = require('hoek');
const Joi = require('joi');


// Declare internals

const internals = {};


internals.schema = Joi.object({
    id: Joi.string().description('Consul service id'),
    tags: Joi.array().items(Joi.string()).unique().single().description('Consul service tags')
});


internals.durationParse = function (duration) {

    return (typeof duration === 'number') ? duration + 'ms' : duration;
};


exports.Consul = module.exports = class {

    constructor(server, serviceConfig, consulOptions) {

        this.config = Joi.attempt(Hoek.reach(server.settings.plugins, 'attache') || {}, internals.schema, 'Invalid server options');

        this.server = server;
        this.service = Hoek.clone(serviceConfig);
        this.api = new Consul(Object.assign({}, consulOptions, { promisify: true }));

        this.service.check.interval = internals.durationParse(this.service.check.interval);
        this.service.check.ttl = internals.durationParse(this.service.check.ttl);
        this.service.check.deregisterAfter = internals.durationParse(this.service.check.deregisterAfter);

        this.connectionId = null;
    }

    register() {

        const { server, service } = this;

        server.log(['attache', 'consul', 'register'], `Registering service: ${this.service.name}`);

        this.connectionId = this.config.id || (service.name + ':' + server.info.port + ':' + process.pid);

        const serviceInfo = {
            name: service.name,
            id: this.connectionId,
            tags: this.config.tags,
            address: server.info.address !== '0.0.0.0' ? server.info.address : undefined,
            port: server.info.port,
            checks: []
        };

        const initialState = service.check.startHealthy ? 'passing' : undefined;

        if (service.check.path) {
            serviceInfo.checks.push({
                http: server.info.uri + service.check.path,
                interval: service.check.interval,
                status: initialState
            });
        }

        if (service.check.ttl) {
            serviceInfo.checks.push({
                ttl: service.check.ttl,
                status: initialState
            });
        }

        if (service.check.deregisterAfter !== false) {
            serviceInfo.checks.forEach((check) => {

                check.deregister_critical_service_after = service.check.deregisterAfter;
            });
        }

        return this._serviceApiCall('register', serviceInfo);
    }

    deregister() {

        const { server } = this;

        server.log(['attache', 'consul', 'deregister'], `Deregistering service: ${this.service.name}`);

        const serviceInfo = {
            id: this.connectionId
        };

        return this._serviceApiCall('deregister', serviceInfo);
    }

    async maintenance(reason) {

        const { server } = this;

        if (reason === undefined) {
            const result = await this.api.agent.check.list();

            return result['_service_maintenance:' + this.connectionId] || false;
        }

        if (reason) {
            server.log(['attache', 'consul', 'maintenance', 'enter'], `Trying to enter maintenance mode for ${this.service.name}, reason: ${reason}`);
        }
        else {
            server.log(['attache', 'consul', 'maintenance', 'exit'], `Trying to exit maintenance mode for ${this.service.name}`);
        }

        const serviceInfo = {
            id: this.connectionId,
            enable: !!reason,
            reason
        };

        return this._serviceApiCall('maintenance', serviceInfo);
    }

    async checkin(ok, note) {

        const { server } = this;

        const method = ok === true ? 'pass' : ok === false ? 'fail' : 'warn';
        const checkInstance = this.service.check.path ? ':2' : '';

        server.log(['attache', 'consul', 'checkin'], `Performing check-in with state: ${ok}`);

        try {
            await this.api.agent.check[method]({
                id: 'service:' + this.connectionId + checkInstance,
                note: note || undefined
            });
        }
        catch (err) {
            server.log(['attache', 'consul', 'checkin', 'error'], err);
            throw err;
        }
    }

    async _serviceApiCall(method, info) {

        try {
            await this.api.agent.service[method](info);
        }
        catch (err) {
            this.server.log(['attache', 'consul', 'error'], err);
            throw err;
        }
    }
};
