// Header de navegación
// 1. Header fijo: fondo sólido al scrollear y ubicado debajo de la barra de
//    administración de Liferay.
// 2. Marca como activa la sección de la página actual.
// 3. En pantallas chicas, abre y cierra el menú "Explorar".
// 4. Muestra el avatar del perfil activo (lo guarda el Selector de perfiles)
//    con un menú para cambiar de perfil o cerrar sesión.

const ACTIVE_PROFILE_KEY = 'nf-perfil-activo';

// Mismos colores que el Selector de perfiles (claves de la picklist Avatares)
const AVATAR_COLORS = {
	amarillo: '#e8b923',
	azul: '#2a7bd8',
	rojo: '#d8352a',
	verde: '#3aa655',
};
const NO_PROFILE_COLOR = '#555';

const header = fragmentElement.querySelector('.nf-header');
const toggle = fragmentElement.querySelector('.nf-header__toggle');
const menu = fragmentElement.querySelector('.nf-header__menu');
const links = fragmentElement.querySelectorAll('.nf-header__link');

const profile = fragmentElement.querySelector('.nf-header__profile');
const profileToggle = fragmentElement.querySelector('.nf-header__profile-toggle');
const profileMenu = fragmentElement.querySelector('.nf-header__profile-menu');
const profileAvatar = fragmentElement.querySelector('.nf-header__avatar');
const profileName = fragmentElement.querySelector('.nf-header__profile-name');
const logoutLink = fragmentElement.querySelector('[data-action="logout"]');

// --- 1. Header fijo ---------------------------------------------------------

// Con un usuario logueado, Liferay muestra su barra de administración arriba
// de todo: el header se corre hacia abajo lo que esa barra ocupe en pantalla.
const controlMenu = document.querySelector('.control-menu-container');

function updateHeader() {
	header.classList.toggle('is-scrolled', window.scrollY > 0);

	if (controlMenu) {
		const offset = Math.max(0, controlMenu.getBoundingClientRect().bottom);

		header.style.setProperty('--nf-header-top', `${offset}px`);
	}
}

updateHeader();
window.addEventListener('scroll', updateHeader, {passive: true});
window.addEventListener('resize', updateHeader);

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
	setProfileMenuOpen(false);
	setMenuOpen(!menu.classList.contains('is-open'));
});

// --- 4. Perfil activo -------------------------------------------------------

function readActiveProfile() {
	try {
		return JSON.parse(sessionStorage.getItem(ACTIVE_PROFILE_KEY));
	}
	catch (error) {
		return null;
	}
}

// Cara simple en SVG, igual a la del Selector de perfiles
function avatarSvg(color) {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');

	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('viewBox', '0 0 100 100');

	const shapes = [
		['rect', {fill: color, height: 100, width: 100}],
		['rect', {fill: '#fff', height: 14, rx: 3, width: 10, x: 30, y: 34}],
		['rect', {fill: '#fff', height: 14, rx: 3, width: 10, x: 60, y: 34}],
		['path', {d: 'M28 62 Q50 82 72 62', fill: 'none', stroke: '#fff', 'stroke-linecap': 'round', 'stroke-width': 6}],
	];

	shapes.forEach(([tag, attrs]) => {
		const shape = document.createElementNS(ns, tag);

		Object.entries(attrs).forEach(([name, value]) => shape.setAttribute(name, value));
		svg.appendChild(shape);
	});

	return svg;
}

function setProfileMenuOpen(open) {
	profileMenu.hidden = !open;
	profileToggle.setAttribute('aria-expanded', String(open));
}

function renderProfile() {
	// Solo para usuarios logueados: un visitante no tiene perfil
	if (!Liferay.ThemeDisplay.isSignedIn()) {
		profile.hidden = true;

		return;
	}

	const active = readActiveProfile();
	const color = (active && AVATAR_COLORS[active.avatar]) || NO_PROFILE_COLOR;

	profileAvatar.replaceChildren(avatarSvg(color));
	profileName.textContent = active ? active.nombre : 'Ningún perfil elegido';
	profileToggle.setAttribute(
		'aria-label',
		active ? `Menú del perfil ${active.nombre}` : 'Menú del perfil'
	);
	profile.hidden = false;
}

profileToggle.addEventListener('click', (event) => {
	event.stopPropagation();
	setMenuOpen(false);
	setProfileMenuOpen(profileMenu.hidden);
});

// Al cerrar sesión, se olvida el perfil activo de esta pestaña
logoutLink.addEventListener('click', () => {
	try {
		sessionStorage.removeItem(ACTIVE_PROFILE_KEY);
	}
	catch (error) {
		// Sin sessionStorage no hay nada que borrar
	}
});

renderProfile();

// --- Cierre de menús --------------------------------------------------------

// Cualquier clic afuera o la tecla Escape cierra los menús abiertos
document.addEventListener('click', (event) => {
	if (!fragmentElement.contains(event.target)) {
		setMenuOpen(false);
		setProfileMenuOpen(false);
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape') {
		return;
	}

	if (menu.classList.contains('is-open')) {
		setMenuOpen(false);
		toggle.focus();
	}

	if (!profileMenu.hidden) {
		setProfileMenuOpen(false);
		profileToggle.focus();
	}
});
