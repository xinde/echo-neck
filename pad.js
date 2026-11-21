function direction(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function bindDirectionPad(pad, strike) {
  const buttons = new Map([...pad.querySelectorAll('[data-dir]')].map((b) => [b.dataset.dir, b]));
  const hub = pad.querySelector('.pad-hub');
  let contact = null;

  function reset() {
    const id = contact?.id;
    contact = null;
    if (id != null && pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
    pad.classList.remove('resting');
    for (const b of buttons.values()) b.classList.remove('pressed');
  }

  function press(dir, event) {
    contact.fired = true;
    pad.classList.remove('resting');
    buttons.get(dir).classList.add('pressed');
    // Use the physical input time even if the main thread handled the event late.
    const time = event.timeStamp;
    strike(dir, time > 0 && time <= performance.now() ? time : performance.now());
  }

  pad.addEventListener('pointerdown', (event) => {
    if (contact || !event.isPrimary || event.button !== 0) return;
    const box = pad.getBoundingClientRect();
    const x = event.clientX,
      y = event.clientY;
    const dx = x - (box.left + box.width / 2),
      dy = y - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > box.width / 2) return;
    event.preventDefault();
    contact = { id: event.pointerId, x, y, fired: false };
    pad.setPointerCapture(event.pointerId);
    if (distance <= hub.getBoundingClientRect().width / 2) pad.classList.add('resting');
    else press(direction(dx, dy), event);
  });

  function swipe(event) {
    if (contact?.id !== event.pointerId || contact.fired) return;
    const dx = event.clientX - contact.x,
      dy = event.clientY - contact.y;
    const major = Math.max(Math.abs(dx), Math.abs(dy));
    if (major >= 18 && major >= Math.min(Math.abs(dx), Math.abs(dy)) * 1.25) {
      press(direction(dx, dy), event);
    }
  }
  pad.addEventListener('pointermove', swipe);

  function release(event) {
    if (contact?.id === event.pointerId) reset();
  }
  pad.addEventListener('pointerup', (event) => {
    swipe(event);
    release(event);
  });
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', (event) => {
    if (event.target === pad) release(event);
  });
  pad.addEventListener('contextmenu', (event) => event.preventDefault());
  // Keyboard and assistive activations have no preceding pointerdown.
  for (const [dir, b] of buttons) {
    b.addEventListener('click', (event) => {
      if (event.detail === 0) strike(dir);
    });
    b.addEventListener('keydown', (event) => {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    });
  }
  return reset;
}
