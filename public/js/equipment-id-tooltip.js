(() => {
  const tooltip = document.createElement('div');
  tooltip.id = 'equipmentDetailsTooltip';
  tooltip.className = 'equipment-details-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let activeTrigger = null;

  const getTrigger = (event) => event.target instanceof Element
    ? event.target.closest('.equipment-id-tooltip-trigger')
    : null;

  const positionTooltip = (x, y) => {
    const padding = 8;
    const gap = 12;
    const bounds = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(padding, x + gap), window.innerWidth - bounds.width - padding);
    const top = y + gap + bounds.height <= window.innerHeight - padding
      ? y + gap
      : Math.max(padding, y - bounds.height - gap);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const showTooltip = (trigger, x, y) => {
    activeTrigger = trigger;
    tooltip.textContent = trigger.dataset.tooltip || '';
    tooltip.hidden = !tooltip.textContent;
    trigger.setAttribute('aria-describedby', tooltip.id);
    if (!tooltip.hidden) positionTooltip(x, y);
  };

  const hideTooltip = (trigger = activeTrigger) => {
    if (!trigger || trigger !== activeTrigger) return;
    trigger.removeAttribute('aria-describedby');
    tooltip.hidden = true;
    activeTrigger = null;
  };

  document.addEventListener('pointerover', (event) => {
    const trigger = getTrigger(event);
    if (!trigger) return;
    showTooltip(trigger, event.clientX, event.clientY);
  });

  document.addEventListener('pointermove', (event) => {
    if (!tooltip.hidden) positionTooltip(event.clientX, event.clientY);
  });

  document.addEventListener('pointerout', (event) => {
    const trigger = getTrigger(event);
    const nextTarget = event.relatedTarget instanceof Element
      ? event.relatedTarget.closest('.equipment-id-tooltip-trigger')
      : null;
    if (!trigger || nextTarget === trigger) return;
    hideTooltip(trigger);
  });

  document.addEventListener('focusin', (event) => {
    const trigger = getTrigger(event);
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    showTooltip(trigger, bounds.left, bounds.bottom);
  });

  document.addEventListener('focusout', (event) => {
    const trigger = getTrigger(event);
    if (trigger) hideTooltip(trigger);
  });

  window.addEventListener('scroll', () => hideTooltip(), true);
  window.addEventListener('resize', () => hideTooltip());
})();
