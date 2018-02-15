const Server = require('node-ssdp').Server

const HUE_BRIDGE = 'urn:schemas-upnp-org:device'

exports.announceBridge = function (config) {
  const server = new Server({
    sourcePort: 1900,
    udn: HUE_BRIDGE,
    ...config,
  })
  server.start()
}
