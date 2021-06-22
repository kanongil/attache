'use strict';

// Load modules

const Consul = require('consul');
const Hoek = require('@hapi/hoek');
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

    connectionId = null;
    api;

    #config;
    #server;
    #service;

    constructor(server, serviceConfig, consulOptions) {

        this.#config = Joi.attempt(Hoek.reach(server.settings.plugins, 'attache') || {}, internals.schema, 'Invalid server options');
        this.#server = server;

        const { check } = this.#service = Hoek.clone(serviceConfig);
        check.interval = internals.durationParse(check.interval);
        check.ttl = internals.durationParse(check.ttl);
        check.deregisterAfter = internals.durationParse(check.deregisterAfter);

        this.api = new Consul(Object.assign({}, consulOptions, { promisify: true }));
    }

    register() {

        this.#server.log(['attache', 'consul', 'register'], `Registering service: ${this.#service.name}`);

        this.connectionId = this.#config.id || (this.#service.name + ':' + this.#server.info.port + ':' + process.pid);

        const serviceInfo = {
            name: this.#service.name,
            id: this.connectionId,
            tags: this.#config.tags,
            address: this.#server.info.address !== '0.0.0.0' ? this.#server.info.address : undefined,
            port: this.#server.info.port,
            checks: []
        };

        const initialState = this.#service.check.startHealthy ? 'passing' : undefined;

        if (this.#service.check.path) {
            serviceInfo.checks.push({
                http: this.#server.info.uri + this.#service.check.path,
                interval: this.#service.check.interval,
                status: initialState
            });
        }

        if (this.#service.check.ttl) {
            serviceInfo.checks.push({
                ttl: this.#service.check.ttl,
                status: initialState
            });
        }

        if (this.#service.check.deregisterAfter !== false) {
            for (const check of serviceInfo.checks) {
                check.deregister_critical_service_after = this.#service.check.deregisterAfter;
            }
        }

        return this._serviceApiCall('register', serviceInfo);
    }

    deregister() {

        this.#server.log(['attache', 'consul', 'deregister'], `Deregistering service: ${this.#service.name}`);

        const serviceInfo = {
            id: this.connectionId
        };

        return this._serviceApiCall('deregister', serviceInfo);
    }

    async maintenance(reason) {

        if (reason === undefined) {
            const result = await this.api.agent.check.list();

            return result['_service_maintenance:' + this.connectionId] || false;
        }

        if (reason) {
            this.#server.log(['attache', 'consul', 'maintenance', 'enter'], `Trying to enter maintenance mode for ${this.#service.name}, reason: ${reason}`);
        }
        else {
            this.#server.log(['attache', 'consul', 'maintenance', 'exit'], `Trying to exit maintenance mode for ${this.#service.name}`);
        }

        const serviceInfo = {
            id: this.connectionId,
            enable: !!reason,
            reason
        };

        return this._serviceApiCall('maintenance', serviceInfo);
    }

    async checkin(ok, note) {

        const method = ok === true ? 'pass' : ok === false ? 'fail' : 'warn';
        const checkInstance = this.#service.check.path ? ':2' : '';

        this.#server.log(['attache', 'consul', 'checkin'], `Performing check-in with state: ${ok}`);

        try {
            await this.api.agent.check[method]({
                id: 'service:' + this.connectionId + checkInstance,
                note: note || undefined
            });
        }
        catch (err) {
            this.#server.log(['attache', 'consul', 'checkin', 'error'], err);
            throw err;
        }
    }

    async _serviceApiCall(method, info) {

        try {
            await this.api.agent.service[method](info);
        }
        catch (err) {
            this.#server.log(['attache', 'consul', 'error'], err);
            throw err;
        }
    }
};
