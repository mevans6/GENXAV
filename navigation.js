const menuButton = document.querySelector('#menu-button');
const mobileMenu = document.querySelector('#mobile-menu');
if (menuButton && mobileMenu) {
  const setMenu = open => {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mobileMenu.hidden = !open;
  };
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menuButton.focus();
    }
  });
  matchMedia('(min-width:1081px)').addEventListener('change', event => { if (event.matches) setMenu(false); });
}

document.querySelectorAll('[data-current-year]').forEach(element => { element.textContent = new Date().getFullYear(); });
