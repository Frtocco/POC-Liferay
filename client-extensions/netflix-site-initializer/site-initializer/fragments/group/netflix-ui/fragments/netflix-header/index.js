// Header de navegación
// 1. Pone fondo sólido al header cuando la página se scrollea.
// 2. Marca como activa la sección de la página actual.
// 3. En pantallas chicas, abre y cierra el menú "Explorar".

const header = fragmentElement.querySelector('.nf-header');
const toggle = fragmentElement.querySelector('.nf-header__toggle');
const menu = fragmentElement.querySelector('.nf-header__menu');
const links = fragmentElement.querySelectorAll('.nf-header__link');

// --- 1. Fondo al hacer scroll ---------------------------------------------

function updateBackground() {
	header.classList.toggle('is-scrolled', window.scrollY > 0);
}

window.addEventListener('scroll', updateBackground, {passive: true});
updateBackground();

// --- 2. Sección activa ------------------------------------------------------

function normalizePath(path) {
	return decodeURIComponent(path).replace(/\/+$/, '').toLowerCase();
}

const currentPath = normalizePath(window.location.pathname);

links.forEach((link) => {
	const linkPath = normalizePath(new URL(link.href, window.location.origin).pathname);

	if (linkPath === currentPath) {
		link.setAttribute('aria-current', 'page');
	}
});

// --- 3. Menú en móvil -------------------------------------------------------

function setMenuOpen(open) {
	menu.classList.toggle('is-open', open);
	toggle.setAttribute('aria-expanded', String(open));
}

toggle.addEventListener('click', (event) => {
	event.stopPropagation();
	setMenuOpen(!menu.classList.contains('is-open'));
});

// Cierra el menú al hacer clic afuera o al apretar Escape
document.addEventListener('click', (event) => {
	if (!fragmentElement.contains(event.target)) {
		setMenuOpen(false);
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && menu.classList.contains('is-open')) {
		setMenuOpen(false);
		toggle.focus();
	}
});
