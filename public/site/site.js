(() => {
  const menu = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#navigation');
  if (menu && navigation) {
    menu.hidden = false;
    const setOpen = open => {
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      navigation.classList.toggle('is-open', open);
    };
    menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
    navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        menu.focus();
      }
    });
    document.addEventListener('click', event => {
      if (event.target instanceof Node && !navigation.contains(event.target) && !menu.contains(event.target)) setOpen(false);
    });
  }
  const groups = [...document.querySelectorAll('.nav-group')];
  groups.forEach(group => group.addEventListener('toggle', () => {
    if (group.open) groups.filter(other => other !== group).forEach(other => { other.open = false; });
  }));
  document.addEventListener('click', event => {
    if (event.target instanceof Node && !navigation?.contains(event.target)) groups.forEach(group => { group.open = false; });
    if (event.target instanceof Element && event.target.closest('#navigation a')) groups.forEach(group => { group.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = groups.find(group => group.open);
    groups.forEach(group => { group.open = false; });
    if (open && !menu?.getClientRects().length) open.querySelector('summary')?.focus();
  });
  const search = document.querySelector('[data-guide-search]');
  if (search) {
    const cards = [...document.querySelectorAll('[data-guide-text]')];
    const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    search.addEventListener('input', () => {
      const terms = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
      cards.forEach(card => { card.hidden = !terms.every(term => normalize(card.dataset.guideText).includes(term)); });
      const count = cards.filter(card => !card.hidden).length;
      const label = document.querySelector('[data-guide-count]');
      if (label) label.textContent = `${count} guide${count !== 1 ? 's' : ''} disponible${count !== 1 ? 's' : ''}`;
      const empty = document.querySelector('[data-guide-empty]');
      if (empty) empty.hidden = count !== 0;
    });
  }
  const tabs = [...document.querySelectorAll('[data-preview]')];
  const select = tab => {
    tabs.forEach(button => {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      button.setAttribute('tabindex', active ? '0' : '-1');
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
        : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      select(target);
      target.focus();
    });
  });
})();
