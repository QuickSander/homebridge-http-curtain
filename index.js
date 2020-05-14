// ISC License
// Original work Copyright (c) 2017, Andreas Bauer
// Modified work Copyright 2020, Sander van Woensel

"use strict";

// -----------------------------------------------------------------------------
// Module variables
// -----------------------------------------------------------------------------
let Service, Characteristic, api;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const configParser = require("homebridge-http-base").configParser;
const http = require("homebridge-http-base").http;
const notifications = require("homebridge-http-base").notifications;
const PullTimer = require("homebridge-http-base").PullTimer;

const PACKAGE_JSON = require('./package.json');
const MANUFACTURER = PACKAGE_JSON.author.name;
const SERIAL_NUMBER = '001';
const MODEL = PACKAGE_JSON.name;
const FIRMWARE_REVISION = PACKAGE_JSON.version;


// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory(MODEL, "HttpCurtain", HttpCurtain);
};

// -----------------------------------------------------------------------------
// Module public functions
// -----------------------------------------------------------------------------

function HttpCurtain(log, config) {
    this.log = log;
    this.name = config.name;
    this.debug = config.debug || false;

    this.targetPosition = 0;

    this.validateUrl = function(url, mandatory=false) {
        if (config[url]) {
            try {
                this[url] = configParser.parseUrlProperty(config[url]);
            } catch (error) {
                this.log.warn("Error occurred while parsing '"+url+"': " + error.message);
                this.log.warn("Aborting...");
                return;
            }
        }
        else if(mandatory) {
            this.log.warn("Property '"+url+"' is required!");
            this.log.warn("Aborting...");
            return;
        }
    };

    this.validateUrl('getCurrentPosUrl', true);
    this.validateUrl('getPositionStateUrl');
    this.validateUrl('setTargetPosUrl', true);
    this.validateUrl('getTargetPosUrl');
    this.validateUrl('identifyUrl');

    this.homebridgeService = new Service.WindowCovering(this.name);
    

    /** @namespace config.pullInterval */
    if (config.pullInterval) {
        this.pullTimer = new PullTimer(log, config.pullInterval, this.getCurrentPosition.bind(this), value => {
            this.homebridgeService.setCharacteristic(Characteristic.CurrentPosition, value);
        });
        this.pullTimer.start();
    }


    api.on('didFinishLaunching', function() {
        // check if notificationRegistration is set, if not 'notificationRegistration' is probably not installed on the system
        if (global.notificationRegistration && typeof global.notificationRegistration === "function") {
            try {
                global.notificationRegistration(config.notificationID, this.handleNotification.bind(this), config.notificationPassword);
            } catch (error) {
                // notificationID is already taken
            }
        }
    }.bind(this));
}

HttpCurtain.prototype = {

    identify: function (callback) {
      this.log("Identify requested!");

      if (this.identifyUrl) {
         http.httpRequest(this.identifyUrl, (error, response, body) => {

             if (error) {
                this.log("identify() failed: %s", error.message);
                callback(error);
             }
             else if (response.statusCode !== 200) {
                this.log("identify() returned http error: %s", response.statusCode);
                callback(new Error("Got http error code " + response.statusCode));
             }
             else {
                callback(null);
             }
         });
      }
      else {
         callback(null);
      }

    },

    getServices: function () {
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
            .setCharacteristic(Characteristic.Model, MODEL)
            .setCharacteristic(Characteristic.SerialNumber, SERIAL_NUMBER)
            .setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);

        this.homebridgeService
            .getCharacteristic(Characteristic.CurrentPosition)
            .on("get", this.getCurrentPosition.bind(this));

        this.homebridgeService
            .getCharacteristic(Characteristic.PositionState)
            .on("get", this.getPositionState.bind(this));

        this.homebridgeService
			.getCharacteristic(Characteristic.TargetPosition)
			.on('get', this.getTargetPosition.bind(this))
			.on('set', this.setTargetPosition.bind(this));


        return [informationService, this.homebridgeService];
    },

    handleNotification: function(body) {
        const value = body.value;

        /** @namespace body.characteristic */
        let characteristic;
        switch (body.characteristic) {
            case "CurrentPosition":
                characteristic = Characteristic.CurrentPosition;
                break;
            case "PositionState":
                characteristic = Characteristic.PositionState;
                break;
            default:
                this.log("Encountered unknown characteristic handling notification: " + body.characteristic);
                return;
        }

        if (this.debug)
            this.log("Updating '" + body.characteristic + "' to new value: " + body.value);
        this.homebridgeService.setCharacteristic(characteristic, value);
    },

    getCurrentPosition: function (callback) {
        http.httpRequest(this.getCurrentPosUrl, (error, response, body) => {
            if (this.pullTimer)
                this.pullTimer.resetTimer();

            if (error) {
                this.log("getCurrentPosition() failed: %s", error.message);
                callback(error);
            }
            else if (response.statusCode !== 200) {
                this.log("getCurrentPosition() returned http error: %s", response.statusCode);
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                const posValue = parseInt(body);
                if (this.debug)
                    this.log("Position value is currently at: %s\%", posValue);

                callback(null, posValue);
            }
        });
    },

    // Seems like HomeKit doesn't care about the state, but rather compares target and current pos.
    getPositionState: function (callback) {
        if (this.getPositionStateUrl) { // Position state URL is optional
            http.httpRequest(this.getPositionStateUrl, (error, response, body) => {
                if (this.pullTimer)
                    this.pullTimer.resetTimer();

                if (error) {
                    this.log("getPositionState() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    this.log("getPositionState() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    const state = parseInt(body);
                    if (this.debug)
                        this.log("Position state is %s", state);

                    callback(null, state);
                }
            });
        }
    },

    setTargetPosition: function (value, callback) {
        this.targetPosition = value;

        // Replace %d with target position.
        let urlObj = {...this.setTargetPosUrl}; 
        urlObj.url = urlObj.url.replace(/%d/g, value.toString());
        if (this.debug)
            this.log("Requesting: %s for value: %d", urlObj.url, value);

        http.httpRequest(urlObj, (error, response, body) => {
            if (error) {
                this.log("setTargetPositionUrl() failed: %s", error.message);
                callback(error);
            }
            else if (response.statusCode !== 200) {
                this.log("setTargetPositionUrl() returned http error: %s; body: %s", response.statusCode), body;
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                if (this.debug)
                    this.log("Succesfully requested target position: %d\%", this.targetPosition);

                callback(null);
            }
        });
    },

    getTargetPosition: function (callback) {
        if (this.getTargetPosUrl) { // Target position URL is optional
            http.httpRequest(this.getTargetPosUrl, (error, response, body) => {
                if (error) {
                    this.log("getTargetPosition() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    this.log("getTargetPosition() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    const targetPosition = parseInt(body);
                    if (this.debug)
                        this.log("Target position retrieved via http: %s\%", targetPosition);

                    callback(null, targetPosition);
                }
            });
        }
        else
        {
            this.log("Target position retrived from cache: %s\%", this.targetPosition);
            callback(null, this.targetPosition);
        }
    },

};
