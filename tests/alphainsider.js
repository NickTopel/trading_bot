
//TODO: wsConnect
//test no server connection on start
  //check if websocket errors or if heartbeat errors when waiting too long without it connecting
  //check if this.ws.close(1000, 'message') can be triggered irispective of opening connection
//test server connection and then disconnected
  //check if removeAllListeners prevents close event from running when calling terminate
//test functioning connection
  //check if invalid strategy id throws error to higher level catch statement