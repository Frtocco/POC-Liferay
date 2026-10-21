// Selector de perfiles ("¿Quién está viendo ahora?")
// 1. Trae los perfiles del usuario logueado desde el Object Perfil.
// 2. Al elegir uno, lo guarda como perfil activo y lleva a la Home.
// 3. Permite agregar perfiles y, en "Administrar perfiles", editarlos o borrarlos.

const API = '/o/c/perfils';
const ACTIVE_PROFILE_KEY = 'nf-perfil-activo';

// Claves de la picklist "Avatares" y el color de cada una
const AVATARS = {
	amarillo: {color: '#e8b923', label: 'Amarillo'},
	azul: {color: '#2a7bd8', label: 'Azul'},
	rojo: {color: '#d8352a', label: 'Rojo'},
	verde: {color: '#3aa655', label: 'Verde'},
};
const DEFAULT_AVATAR = 'rojo';

const root = fragmentElement.querySelector('.nf-profiles');
const list = fragmentElement.querySelector('.nf-profiles__list');
const status = fragmentElement.querySelector('.nf-profiles__status');
const manageButton = fragmentElement.querySelector('.nf-profiles__manage');

const dialog = fragmentElement.querySelector('.nf-profiles__dialog');
const form = fragmentElement.querySelector('.nf-profiles__form');
const formTitle = fragmentElement.querySelector('.nf-profiles__form-title');
const nameInput = form.elements.nombre;
const kidsInput = form.elements.infantil;
const nameError = fragmentElement.querySelector('.nf-profiles__error');
const avatarsFieldset = fragmentElement.querySelector('.nf-profiles__avatars');
const formStatus = fragmentElement.querySelector('.nf-profiles__form-status');
const saveButton = form.querySelector('[value="save"]');
const cancelButton = form.querySelector('[data-action="cancel"]');
const deleteButton = form.querySelector('[data-action="delete"]');

const userId = Liferay.ThemeDisplay.getUserId();
const maxProfiles = parseInt(root.dataset.max, 10) || 5;

let profiles = [];
let editing = null; // perfil que se está editando; null = alta
let managing = false;

// ---------- Utilidades ----------

function isEditingPage() {
	const mode = root.dataset.layoutMode;

	return (mode && mode !== 'view') || new URLSearchParams(window.location.search).has('p_l_mode');
}

async function request(path, {body, method = 'GET'} = {}) {
	const response = await fetch(path, {
		body: body ? JSON.stringify(body) : undefined,
		credentials: 'include',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'x-csrf-token': Liferay.authToken,
		},
		method,
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} en ${method} ${path}`);
	}

	return response.status === 204 ? null : response.json();
}

function showStatus(message) {
	status.textContent = message;
	status.hidden = !message;
}

function avatarKey(profile) {
	const key = profile.avatar?.key;

	return AVATARS[key] ? key : DEFAULT_AVATAR;
}

// Cara simple dibujada en SVG sobre el color del avatar
function avatarSvg(key) {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');

	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('viewBox', '0 0 100 100');

	const shapes = [
		['rect', {fill: AVATARS[key].color, height: 100, width: 100}],
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

function saveActiveProfile(profile) {
	try {
		sessionStorage.setItem(
			ACTIVE_PROFILE_KEY,
			JSON.stringify({
				avatar: avatarKey(profile),
				id: profile.id,
				infantil: Boolean(profile.infantil),
				nombre: profile.nombre,
			})
		);
	}
	catch (error) {
		console.warn('[Selector de perfiles] No se pudo guardar el perfil activo', error);
	}
}

// ---------- Render ----------

function buildTile(profile) {
	const item = document.createElement('li');
	const tile = document.createElement('button');

	tile.className = 'nf-profiles__tile';
	tile.type = 'button';

	const avatar = document.createElement('span');

	avatar.className = 'nf-profiles__avatar';
	avatar.appendChild(avatarSvg(avatarKey(profile)));

	if (profile.infantil) {
		const kids = document.createElement('span');

		kids.className = 'nf-profiles__kids';
		kids.textContent = 'Niños';
		avatar.appendChild(kids);
	}

	const name = document.createElement('span');

	name.className = 'nf-profiles__name';
	name.textContent = profile.nombre;

	tile.append(avatar, name);
	tile.addEventListener('click', () => {
		if (managing) {
			openDialog(profile);
		}
		else {
			saveActiveProfile(profile);
			window.location.assign(root.dataset.homePath);
		}
	});

	item.appendChild(tile);

	return item;
}

function buildAddTile() {
	const item = document.createElement('li');
	const tile = document.createElement('button');

	tile.className = 'nf-profiles__tile';
	tile.type = 'button';

	const avatar = document.createElement('span');

	avatar.className = 'nf-profiles__avatar nf-profiles__avatar--add';
	avatar.innerHTML =
		'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v10M7 12h10"/></svg>';

	const name = document.createElement('span');

	name.className = 'nf-profiles__name';
	name.textContent = 'Agregar perfil';

	tile.append(avatar, name);
	tile.addEventListener('click', () => openDialog(null));

	item.appendChild(tile);

	return item;
}

function render() {
	const items = profiles.map(buildTile);

	if (profiles.length < maxProfiles) {
		items.push(buildAddTile());
	}

	list.replaceChildren(...items);
	manageButton.hidden = !profiles.length;
	showStatus(profiles.length ? '' : 'Creá tu primer perfil para empezar.');
}

function setManaging(value) {
	managing = value;
	root.classList.toggle('is-managing', value);
	manageButton.setAttribute('aria-pressed', String(value));
	manageButton.textContent = value ? 'Listo' : 'Administrar perfiles';
}

// ---------- Modal ----------

function buildAvatarOptions() {
	const legend = avatarsFieldset.querySelector('legend');

	const options = Object.entries(AVATARS).map(([key, {label}]) => {
		const option = document.createElement('label');

		option.className = 'nf-profiles__avatar-option';

		const input = document.createElement('input');

		input.name = 'avatar';
		input.type = 'radio';
		input.value = key;
		input.setAttribute('aria-label', label);

		const avatar = document.createElement('span');

		avatar.className = 'nf-profiles__avatar';
		avatar.appendChild(avatarSvg(key));

		option.append(input, avatar);

		return option;
	});

	avatarsFieldset.replaceChildren(legend, ...options);
}

function openDialog(profile) {
	editing = profile;
	form.reset();

	formTitle.textContent = profile ? 'Editar perfil' : 'Agregar perfil';
	nameInput.value = profile ? profile.nombre : '';
	kidsInput.checked = Boolean(profile?.infantil);
	form.elements.avatar.value = profile ? avatarKey(profile) : DEFAULT_AVATAR;

	deleteButton.hidden = !profile;
	nameInput.removeAttribute('aria-invalid');
	nameError.hidden = true;
	formStatus.hidden = true;

	dialog.showModal();
	nameInput.focus();
}

function setBusy(busy) {
	[saveButton, cancelButton, deleteButton].forEach((button) => {
		button.disabled = busy;
	});
}

function showFormError(message) {
	formStatus.textContent = message;
	formStatus.hidden = false;
}

async function saveProfile(event) {
	event.preventDefault();

	const nombre = nameInput.value.trim();

	if (!nombre) {
		nameInput.setAttribute('aria-invalid', 'true');
		nameError.hidden = false;
		nameInput.focus();

		return;
	}

	const body = {
		avatar: {key: form.elements.avatar.value || DEFAULT_AVATAR},
		infantil: kidsInput.checked,
		nombre,
	};

	setBusy(true);

	try {
		if (editing) {
			await request(`${API}/${editing.id}`, {body, method: 'PATCH'});
		}
		else {
			await request(`${API}/`, {body: {...body, r_perfiles_userId: Number(userId)}, method: 'POST'});
		}

		dialog.close();
		await loadProfiles();
	}
	catch (error) {
		console.error('[Selector de perfiles]', error);
		showFormError(
			editing
				? 'No se pudo guardar el perfil. Solo podés editar los perfiles que creaste vos.'
				: 'No se pudo crear el perfil. Revisá en la consola el detalle del error.'
		);
	}
	finally {
		setBusy(false);
	}
}

async function deleteProfile() {
	if (!editing || !window.confirm(`¿Eliminar el perfil "${editing.nombre}"?`)) {
		return;
	}

	setBusy(true);

	try {
		await request(`${API}/${editing.id}`, {method: 'DELETE'});
		dialog.close();
		await loadProfiles();
	}
	catch (error) {
		console.error('[Selector de perfiles]', error);
		showFormError('No se pudo eliminar el perfil. Solo podés eliminar los perfiles que creaste vos.');
	}
	finally {
		setBusy(false);
	}
}

// ---------- Carga ----------

async function loadProfiles() {
	const filter = encodeURIComponent(`r_perfiles_userId eq '${userId}'`);
	const data = await request(`${API}?filter=${filter}&pageSize=${maxProfiles}&sort=dateCreated:asc`);

	profiles = data.items || [];
	render();
}

async function init() {
	if (!Liferay.ThemeDisplay.isSignedIn()) {
		if (isEditingPage()) {
			showStatus('Iniciá sesión para ver los perfiles.');
		}
		else {
			window.location.replace(root.dataset.loginPath);
		}

		return;
	}

	buildAvatarOptions();

	manageButton.addEventListener('click', () => setManaging(!managing));
	form.addEventListener('submit', saveProfile);
	cancelButton.addEventListener('click', () => dialog.close());
	deleteButton.addEventListener('click', deleteProfile);
	nameInput.addEventListener('input', () => {
		nameInput.removeAttribute('aria-invalid');
		nameError.hidden = true;
	});

	// Cerrar haciendo clic en el fondo oscuro
	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) {
			dialog.close();
		}
	});

	try {
		await loadProfiles();
	}
	catch (error) {
		console.error('[Selector de perfiles]', error);
		showStatus('No se pudieron cargar los perfiles. El detalle está en la consola del navegador.');
	}
}

init();
