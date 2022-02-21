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
    this.validateUrl('getPositionStateUrl');
    this.validateUrl('identifyUrl');
    
    this.getCurrentPosRegEx = config.getCurrentPosRegEx || '';
    this.getTargetPosRegEx = config.getTargetPosRegEx || '';

    this.homebridgeService = new Service.WindowCovering(this.name);
    
    if (config.pullInterval) {
        this.pullTimer = new PullTimer(log, config.pullInterval, this.getCurrentPosition.bind(this), value => {
            this.homebridgeService.setCharacteristic(Characteristic.CurrentPosition, value);
        });
        this.pullTimer.start();
    }

    this.invertPosition = config.invertPosition || false

    api.on('didFinishLaunching', function() {
        // Check if notificationRegistration is set, if not 'notificationRegistration' is probably not installed on the system.
        if (global.notificationRegistration && typeof global.notificationRegistration === "function") {
            try {
                global.notificationRegistration(config.notificationID, this.handleNotification.bind(this), config.notificationPassword);
            } catch (error) {
                // notificationID is already taken.
            }
        }
    }.bind(this));
}

HttpCurtain.prototype = {

    identify: function (callback) {
      this.log.info("Identify requested");

      if (this.identifyUrl) {
         http.httpRequest(this.identifyUrl, (error, response, body) => {

             if (error) {
                this.log.error("identify() failed: %s", error.message);
                callback(error);
             }
             else if (response.statusCode !== 200) {
                this.log.error("identify() returned http error: %s", response.statusCode);
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

        let characteristic;
        switch (body.characteristic) {
            case "CurrentPosition":
                characteristic = Characteristic.CurrentPosition;
                break;
            case "PositionState":
                characteristic = Characteristic.PositionState;
                break;
            default:
                this.log.warn("Encountered unknown characteristic handling notification: " + body.characteristic);
                return;
        }

        this.log.debug("Update received from device: " + body.characteristic + ": " + body.value);
        this.homebridgeService.setCharacteristic(characteristic, value);
    },

    getCurrentPosition: function (callback) {
        http.httpRequest(this.getCurrentPosUrl, (error, response, body) => {
            if (this.pullTimer)
                this.pullTimer.resetTimer();

            if (error) {
                this.log.error("getCurrentPosition() failed: %s", error.message);
                callback(error);
            }
            else if (response.statusCode !== 200) {
                this.log.error("getCurrentPosition() returned http error: %s", response.statusCode);
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                if(this.getCurrentPosRegEx) {
                    let matches = body.match(this.getCurrentPosRegEx);
                    if(matches && matches.length > 1) {
                        body = matches[1];
                        this.log.debug("Retrieving current position via regular expression. Full ungrouped match: %s", matches[0]);
                    }
                    else {
                        this.log.warn("Your CurrentPosRegEx regular expression: \"%s\" did not match any part of the returned body: \"%s\"", this.getCurrentPosRegEx, body);
                    }
                }
                let posValue = parseInt(body);
                this.log.info("Current position (retrieved via http): %s\%", posValue);

                if (this.invertPosition) {
                    posValue = 100 - posValue;
                }

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
                    this.log.error("getPositionState() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    this.log.error("getPositionState() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    const state = parseInt(body);
                    this.log.info("Position state: %s", state);

                    callback(null, state);
                }
            });
        } else {
           this.log.debug("Position state URL not configured. Returning: Stopped ("+Characteristic.PositionState.STOPPED+")");
           callback(null, Characteristic.PositionState.STOPPED); // No state defined.
        }
    },

    setTargetPosition: function (value, callback) {
        this.targetPosition = value;

        if (this.invertPosition) {
            value = 100 - value;
        }

        // Replace %d with target position.
        let urlObj = {...this.setTargetPosUrl}; 
        urlObj.url = urlObj.url.replace(/%d/g, value.toString());
        urlObj.body = urlObj.body.replace(/%d/g, value.toString());
        this.log.info("Requesting: %s for value: %d", urlObj.url, value);

        http.httpRequest(urlObj, (error, response, body) => {
            if (error) {
                this.log.error("setTargetPositionUrl() failed: %s", error.message);
                callback(error);
            }
            else if (response.statusCode !== 200) {
                this.log.error("setTargetPositionUrl() returned http error: %s; body: %s", response.statusCode), body;
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                this.log.debug("Succesfully requested target position: %d\%", value);

                callback(null);
            }
        });
    },

    getTargetPosition: function (callback) {
        if (this.getTargetPosUrl) { // Target position URL is optional
            http.httpRequest(this.getTargetPosUrl, (error, response, body) => {
                if (error) {
                    this.log.error("getTargetPosition() failed: %s", error.message);
                    callback(error);
                }
                else if (response.statusCode !== 200) {
                    this.log.error("getTargetPosition() returned http error: %s", response.statusCode);
                    callback(new Error("Got http error code " + response.statusCode));
                }
                else {
                    if(this.getTargetPosRegEx) {
                        let matches = body.match(this.getTargetPosRegEx);
                        if(matches && matches.length > 1) {
                            body = matches[1];
                            this.log.debug("Retrieving target position via regular expression. Full ungrouped match: %s", matches[0]);
                        }
                        else {
                            this.log.warn("Your TargetPosRegEx regular expression: \"%s\" did not match any part of the returned body: \"%s\"", this.getTargetPosRegEx, body);
                        }
                    }

                    let targetPosition = parseInt(body);
                    this.log.info("Target position (retrieved via http): %s\%", targetPosition);

                    if (this.invertPosition) {
                        targetPosition = 100 - targetPosition;
                    }

                    callback(null, targetPosition);
                }
            });
        }
        else
        {
            this.log.info("Target position (retrieved from cache): %s\%", this.targetPosition);
            callback(null, this.targetPosition);
        }
    },

};
