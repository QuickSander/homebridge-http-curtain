[![Build Status](https://travis-ci.com/QuickSander/homebridge-http-curtain.svg?branch=master)](https://travis-ci.com/QuickSander/homebridge-http-curtain)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![npm version](https://badge.fury.io/js/homebridge-http-curtain.svg)](https://badge.fury.io/js/homebridge-http-curtain)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

# homebridge-http-curtain

This [Homebridge](https://github.com/nfarina/homebridge) plugin can be used to integrate your curtain which has an HTTP api into HomeKit. This controller supports push notification _without_ the need for HomeBridge to periodically pull the curtain position value. There are a few other HTTP based curtain / window blinds
plugins available, but I have not found any yet that does not poll the curtain controller continuously for position or state updates.

_This is a fork of Supereg's [homebridge-http-temperature-sensor](https://github.com/Supereg/homebridge-http-temperature-sensor) modified to function as an curtain controller._

Features:
* Set target position (0-100).
* Position change updates: push (efficient / less network and Homebridge load) or pull (easy to configure).
* Retrieve current position.
* Send identify request (via Eve Home app) to locate your curtain

## Installation

First of all you need to have [Homebridge](https://github.com/nfarina/homebridge) installed. Refer to the repo for
instructions.  
Then run the following command to install `homebridge-http-curtain`

```
sudo npm install -g homebridge-http-curtain
```

## Updating the curtain position in HomeKit

The _'CurrentPosition'_ characteristic from the _'WindowCovering'_ service has the permission to `notify` the
HomeKit controller of state changes.
`homebridge-http-curtain` supports two ways to send window blinds/curtain position changes to HomeKit.

#### The 'pull' way:

The 'pull' way is probably the easiest to set up and supported in every scenario. `homebridge-http-curtain`
requests the value of the curtain/window blind in an specified interval (pulling) and sends the value to HomeKit.  
Look for `pullInterval` in the list of configuration options if you want to configure it.

#### The 'push' way:

When using the 'push' concept the HTTP device itself sends the updated value itself to `homebridge-http-curtain`
whenever the value changes. This is more efficient as the new value is updated instantly and
`homebridge-http-curtain` does not need to make needless requests when the value didn't actually change.
However because the http device needs to actively notify the `homebridge-http-curtain` plugin there is more
work needed to implement this method into your http device.  
How to implement the protocol into your http device can be read in the chapter [**Notification Server**](#notification-server)

## Configuration

The configuration can contain the following properties:
* `name` \<string\> **required**: Defines the name which is later displayed in HomeKit
* `getCurrentPosUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url
(and other properties when using an urlObject) to query the current position from the curtain.
It expects the http server to return a integer ranging from 0-100 (step 1) leaving out any html markup when no `getCurrentPosRegEx`
is provided.
* `getCurrentPosRegEx` \<string\> **optional**: A regular expression from which the first matched group determines the current position.
* `getPositionStateUrl` \<string | [urlObject](#urlobject)\> **optional**: Defines the url
(and other properties when using an urlObject) to query the current state from the curtain.
It expects the http server to return a integer '0' (Closing), '1' (Opening) or '2' (Idle) leaving out any html markup.
Note that Homekit ignores this state as it rather compares _CurrentPosition_ with _TargetPosition_.
* `setTargetPosUrl` \<string | [urlObject](#urlobject)\> **required**: Defines the url
(and other properties when using an urlObject) to set the target position at the curtain.
Any `%d` format specifier will be replaced by the requested target position.
* `getTargetPosUrl` \<string | [urlObject](#urlobject)\> **optional**: Defines the url
(and other properties when using an urlObject) to retrieve the target position at the curtain.
* `getTargetPosRegEx` \<string\> **optional**: A regular expression from which the first matched group determines the target position.
* `identifyUrl` \<string | [urlObject](#urlobject)\> **optional**: URL to call when the HomeKit identify action is requested.
* `pullInterval` \<integer\> **optional**: The property expects an interval in **milliseconds** in which the plugin
pulls updates from your http device. For more information read [pulling updates](#the-pull-way).  
* `debug` \<boolean\> **optional**: Enable debug mode and write more logs.


Below is an example configuration. One URL is using a simple string URL and the other is using an urlObject.  
Both configs can be used for a basic plugin configuration.
```json
{
    "accessories": [
        {
          "accessory": "HttpCurtain",
          "name": "Living Room Left Curtain",

          "getCurrentPosUrl": "http://livingroom-curtain-left/api/v1/pos",
          "setTargetPosUrl": {
            "url": "http://livingroom-curtain-left/api/v1/pos/%d",
            "method": "PUT"
          }
        }   
    ]
}
```




#### UrlObject

A urlObject can have the following properties:
* `url` \<string\> **required**: Defines the url pointing to your http server
* `method` \<string\> **optional** \(Default: **"GET"**\): Defines the http method used to make the http request
* `body` \<string\> **optional**: Defines the body sent with the http request
* `auth` \<object\> **optional**: If your http server uses basic authentication you can specify your credential in this
object. When defined the object must contain the following properties:
    * `username` \<string\>
    * `password` \<string\>
* `headers` \<object\> **optional**: Using this object you can define any http headers which are sent with the http
request. The object must contain only string key value pairs.  

Below is an example of an urlObject containing all properties:
```json
{
  "url": "http://example.com:8080",
  "method": "GET",
  "body": "exampleBody",

  "auth": {
    "username": "yourUsername",
    "password": "yourPassword"
  },

  "headers": {
    "Content-Type": "text/html"
  }
}
```

## Notification Server

`homebridge-http-curtain` can be used together with
[homebridge-http-notification-server](https://github.com/Supereg/homebridge-http-notification-server) in order to receive
updates when the state changes at your external program. For details on how to implement those updates and how to
install and configure `homebridge-http-notification-server`, please refer to the
[README](https://github.com/Supereg/homebridge-http-notification-server) of the repository.

Down here is an example on how to configure `homebridge-http-curtain` to work with your implementation of the
`homebridge-http-notification-server`.

```json
{
    "accessories": [
        {
          "accessory": "HttpCurtain",
          "name": "Living Room Curtain",

          "notificationID": "my-curtain",
          "notificationPassword": "SuperSecretPassword",

          "getUrl": "http://localhost/api/pos"
        }   
    ]
}
```

* `notificationID` is an per Homebridge instance unique id which must be included in any http request.  
* `notificationPassword` is **optional**. It can be used to secure any incoming requests.

To get more details about the configuration have a look at the
[README](https://github.com/Supereg/homebridge-http-notification-server).

**Available characteristics (for the POST body)**

Down here are all characteristics listed which can be updated with an request to the `homebridge-http-notification-server`

* `characteristic` "CurrentPosition": expects an integer `value` in a range of 0 up to and including 100.

