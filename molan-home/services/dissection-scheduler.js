'use strict';

function createDissectionScheduler({ maxConcurrent, loadRecord }) {
  const activeDissections = new Map();
  const activeDissectionsByUser = new Map();
  let runningCount = 0;
  async function waitForDissectionCapacity(id, email, controller) {
    while (runningCount >= maxConcurrent) {
      const latest = loadRecord(id, email);
      if (!latest || latest.cancelRequested || latest.status === 'cancelled' || controller.signal.aborted) {
        throw Object.assign(new Error('拆书任务已取消'), { cancelled: true });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (controller.signal.aborted) throw Object.assign(new Error('拆书任务已取消'), { cancelled: true });
    runningCount += 1;
  }
  function releaseCapacity() { runningCount = Math.max(0, runningCount - 1); }
  function acquireDissectionUserSlot(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key || (activeDissectionsByUser.get(key) || 0) >= 1) return false;
    activeDissectionsByUser.set(key, (activeDissectionsByUser.get(key) || 0) + 1);
    return true;
  }
  function releaseDissectionUserSlot(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return;
    const remaining = Math.max(0, (activeDissectionsByUser.get(key) || 1) - 1);
    if (remaining) activeDissectionsByUser.set(key, remaining);
    else activeDissectionsByUser.delete(key);
  }
  return { activeDissections, activeDissectionsByUser, waitForDissectionCapacity,
    releaseCapacity, acquireDissectionUserSlot, releaseDissectionUserSlot };
}

module.exports = { createDissectionScheduler };
