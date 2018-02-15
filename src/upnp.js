const Server = require('../packages/node-ssdp').Server

const HUE_BRIDGE = 'urn:schemas-upnp-org:device'

exports.announceBridge = function (config) {
  const server = new Server({
    sourcePort: 1900,
    udn: HUE_BRIDGE,
    'hue-bridgeip': '192.168.72.41',
    ...config,
  })
  server.start()
}
