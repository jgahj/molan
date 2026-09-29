'use strict';

/** 监听响应断开并只触发一次回调；正常结束前调用 dispose 清理监听。 */
function attachResponseDisconnect(response, onDisconnect) {
  let disconnected = false;
  let active = true;
  const handleClose = () => {
    if (!active || disconnected) return;
    disconnected = true;
    onDisconnect();
  };
  response.once('close', handleClose);
  if (response.destroyed) handleClose();
  return {
    get disconnected() { return disconnected; },
    dispose() {
      if (!active) return;
      active = false;
      response.removeListener('close', handleClose);
    }
  };
}

module.exports = { attachResponseDisconnect };
