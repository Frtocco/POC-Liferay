// Continuar viendo
// Escucha los clics de los fragments de títulos y guarda, por perfil, los
// cuatro más recientes. El progreso avanza 25 puntos hasta llegar a 90;
// el quinto clic marca el titulo como terminado y lo elimina de la fila.

const STRUCTURE_NAME = 'Título';
const CLICK_EVENT = 'nf:titulo-click';
const ACTIVE_PROFILE_KEY = 'nf-perfil-activo';
const MAX_TITLES = 4;
const PROGRESS_STEP = 25;
const MAX_PROGRESS = 90;
const PAGE_SIZE = 100;

const FIELDS = {
	anio: 'anio',
	clasificacion: 'clasificacion',
	duracion: 'duracion',
	elenco: 'elenco',
	fondo: 'fondo',
	poster: 'poster',
	sinopsis: 'sinopsis',
	temporadas: 'temporadas',
};

const TIPOS = ['pelicula', 'serie'];

const row = fragmentElement.querySelector('.nf-continue');
const track = fragmentElement.querySelector('.nf-continue__track');
const status = fragmentElement.querySelector('.nf-continue__status');
const dialog = fragmentElement.querySelector('.nf-continue__dialog');
const dialogImage = fragmentElement.querySelector('.nf-continue__dialog-image');
const dialogTitle = fragmentElement.querySelector('.nf-continue__dialog-title');
const dialogMeta = fragmentElement.querySelector('.nf-continue__dialog-meta');
const dialogSynopsis = fragmentElement.querySelector('.nf-continue__dialog-synopsis');
const closeButton = fragmentElement.querySelector('.nf-continue__dialog-close');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const userId = Liferay.ThemeDisplay.getUserId();
const isEditMode = typeof layoutMode !== 'undefined' && layoutMode === 'edit';

function activeProfileId() {
	try {
		const profile = JSON.parse(sessionStorage.getItem(ACTIVE_PROFILE_KEY) || 'null');

		return profile?.id ? `profile-${profile.id}` : `user-${userId || 'guest'}`;
	}
	catch (error) {
		console.warn('[Continuar viendo] No se pudo leer el perfil activo.', error);

		return `user-${userId || 'guest'}`;
	}
}

const storageKey = `nf-continue-watching:v1:${siteId}:${activeProfileId()}`;
const dialogId = `nf-continue-dialog-${Math.random().toString(36).slice(2, 8)}`;

dialog.id = dialogId;
dialogTitle.id = `${dialogId}-title`;
dialog.setAttribute('aria-labelledby', dialogTitle.id);

function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function storageBackend() {
	try {
		const probe = `${storageKey}:probe`;

		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);

		return localStorage;
	}
	catch (error) {
		console.warn('[Continuar viendo] localStorage no está disponible; se usa sessionStorage.', error);

		return sessionStorage;
	}
}

const storage = storageBackend();

function titleKey(item) {
	if (item.externalReferenceCode) {
		return `erc:${item.externalReferenceCode}`;
	}

	if (item.id) {
		return `id:${item.id}`;
	}

	return `title:${normalize(item.title)}`;
}

function readHistory() {
	try {
		const value = JSON.parse(storage.getItem(storageKey) || '[]');

		return Array.isArray(value) ? value.slice(0, MAX_TITLES) : [];
	}
	catch (error) {
		console.warn('[Continuar viendo] No se pudo leer el historial local.', error);

		return [];
	}
}

function writeHistory(history) {
	try {
		storage.setItem(storageKey, JSON.stringify(history.slice(0, MAX_TITLES)));
	}
	catch (error) {
		console.warn('[Continuar viendo] No se pudo guardar el historial local.', error);
	}
}

function recordTitle(item) {
	if (!item || (!item.id && !item.externalReferenceCode && !item.title)) {
		return;
	}

	const history = readHistory();
	const key = titleKey(item);
	const previous = history.find((entry) => entry.key === key);

	if ((Number(previous?.progress) || 0) >= MAX_PROGRESS) {
		writeHistory(history.filter((entry) => entry.key !== key));
		load();

		return;
	}

	const progress = Math.min(
		MAX_PROGRESS,
		(Number(previous?.progress) || 0) + PROGRESS_STEP
	);
	const nextEntry = {
		contentId: item.id || previous?.contentId || null,
		key,
		progress,
		updatedAt: Date.now(),
	};
	const nextHistory = [
		nextEntry,
		...history.filter((entry) => entry.key !== key),
	].slice(0, MAX_TITLES);

	writeHistory(nextHistory);
}

function clickedTitle(target) {
	if (!(target instanceof Element)) {
		return '';
	}

	const card = target.closest('.nf-movie-card, .nf-trending-card, .nf-card');

	if (card && !card.closest('.nf-continue')) {
		return (
			card.querySelector(
				'.nf-movie-card__info h3, .nf-trending-card__title, .nf-card__title'
			)?.textContent.trim() || ''
		);
	}

	const heroButton = target.closest('.nf-hero__button--play, .nf-hero__button--info');

	return heroButton?.closest('.nf-hero')?.querySelector('.nf-hero__title')?.textContent.trim() || '';
}

async function recordTitleByName(title) {
	if (!title) {
		return;
	}

	try {
		const normalizedTitle = normalize(title);
		const contents = await getContents();
		const item = contents.find((content) => normalize(content.title) === normalizedTitle);

		if (item) {
			recordTitle(item);
		}
	}
	catch (error) {
		console.warn('[Continuar viendo] No se pudo registrar el clic detectado.', error);
	}
}

// Una sola escucha por sitio/perfil, incluso si por error se agrega el fragment
// más de una vez a la página.
const recorderRegistry = (window.__nfContinueWatchingRecorders =
	window.__nfContinueWatchingRecorders || {});

if (!recorderRegistry[storageKey]) {
	let lastCustomClick = {at: 0, title: ''};

	document.addEventListener(CLICK_EVENT, (event) => {
		lastCustomClick = {
			at: Date.now(),
			title: normalize(event.detail?.item?.title),
		};
		recordTitle(event.detail?.item);
	});

	// Compatibilidad con instancias antiguas de los fragments, que Liferay no
	// actualiza por si solo cuando cambia el codigo fuente del fragment.
	const recordLegacyClick = (event) => {
		const title = clickedTitle(event.target);

		if (
			title &&
			(normalize(title) !== lastCustomClick.title || Date.now() - lastCustomClick.at > 1000)
		) {
			recordTitleByName(title);
		}
	};

	document.addEventListener('click', recordLegacyClick);
	document.addEventListener('keydown', (event) => {
		if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('article')) {
			recordLegacyClick(event);
		}
	});
	recorderRegistry[storageKey] = true;
}

async function getJSON(path) {
	const response = await fetch(path, {
		credentials: 'include',
		headers: {
			'Accept': 'application/json',
			'x-csrf-token': Liferay.authToken,
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} al pedir ${path}`);
	}

	return response.json();
}

const dataCache = (window.__nfStreamingCache = window.__nfStreamingCache || {});

function getStructure() {
	dataCache.structure =
		dataCache.structure ||
		getJSON(
			`/o/headless-delivery/v1.0/sites/${siteId}/content-structures?pageSize=${PAGE_SIZE}`
		).then((structures) => {
			const structure = structures.items.find(
				(item) => normalize(item.name) === normalize(STRUCTURE_NAME)
			);

			if (!structure) {
				throw new Error(`No existe el Content Type "${STRUCTURE_NAME}" en este sitio.`);
			}

			return structure;
		});

	return dataCache.structure;
}

async function fetchAllContents(structureId) {
	const items = [];
	let page = 1;
	let lastPage = 1;

	do {
		const data = await getJSON(
			`/o/headless-delivery/v1.0/content-structures/${structureId}/structured-contents` +
				`?page=${page}&pageSize=${PAGE_SIZE}`
		);

		items.push(...data.items);
		lastPage = data.lastPage || 1;
		page++;
	} while (page <= lastPage);

	return items;
}

function getContents() {
	dataCache.contents =
		dataCache.contents || getStructure().then((structure) => fetchAllContents(structure.id));

	dataCache.contents.catch(() => {
		dataCache.structure = null;
		dataCache.contents = null;
	});

	return dataCache.contents;
}

function fieldValues(item, name) {
	return (item.contentFields || [])
		.filter((field) => field.name === name)
		.map((field) => field.contentFieldValue)
		.filter(Boolean);
}

function fieldValue(item, name) {
	return fieldValues(item, name)[0];
}

function fieldText(item, name) {
	const value = fieldValue(item, name);

	return value?.data ? String(value.data).trim() : '';
}

function imageUrl(item) {
	if (normalize(item.title).includes('viaje de chihiro') && row.dataset.chihiroBackdrop) {
		return row.dataset.chihiroBackdrop;
	}

	return (
		fieldValue(item, FIELDS.fondo)?.image?.contentUrl ||
		fieldValue(item, FIELDS.poster)?.image?.contentUrl ||
		''
	);
}

function formatDuration(minutes) {
	const total = parseInt(minutes, 10);

	if (!total) {
		return '';
	}

	const hours = Math.floor(total / 60);
	const rest = total % 60;

	return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

function createElement(tagName, className, text) {
	const element = document.createElement(tagName);

	element.className = className;

	if (text !== undefined) {
		element.textContent = text;
	}

	return element;
}

function addDialogMeta(text, badge = false) {
	if (!text) {
		return;
	}

	const entry = document.createElement('li');

	entry.textContent = text;

	if (badge) {
		entry.className = 'nf-continue__dialog-badge';
	}

	dialogMeta.appendChild(entry);
}

function setDialogExtra(field, values) {
	const detail = dialog.querySelector(`.nf-continue__dialog-extra[data-field="${field}"]`);

	detail.querySelector('.nf-continue__dialog-value').textContent = values.join(', ');
	detail.hidden = !values.length;
}

function renderDialog(item) {
	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const isSeries = names.some((name) => normalize(name) === 'serie');
	const image = imageUrl(item);

	dialogImage.hidden = !image;

	if (image) {
		dialogImage.src = image;
	}
	else {
		dialogImage.removeAttribute('src');
	}

	dialogTitle.textContent = item.title;
	dialogSynopsis.textContent = fieldText(item, FIELDS.sinopsis);
	dialogMeta.replaceChildren();
	addDialogMeta(fieldText(item, FIELDS.anio));
	addDialogMeta(fieldText(item, FIELDS.clasificacion), true);

	if (isSeries) {
		const seasons = parseInt(fieldText(item, FIELDS.temporadas), 10);

		addDialogMeta(seasons ? `${seasons} ${seasons === 1 ? 'temporada' : 'temporadas'}` : '');
	}
	else {
		addDialogMeta(formatDuration(fieldText(item, FIELDS.duracion)));
	}

	const cast = fieldValues(item, FIELDS.elenco)
		.map((value) => String(value.data || '').trim())
		.filter(Boolean);
	const genres = names.filter((name) => !TIPOS.includes(normalize(name)));

	setDialogExtra('elenco', cast);
	setDialogExtra('generos', genres);
}

let dialogOpener = null;

function openDialog(item, opener) {
	dialogOpener = opener;
	renderDialog(item);
	dialog.scrollTop = 0;
	dialog.showModal();
	document.documentElement.classList.add('nf-continue-dialog-lock');
	closeButton.focus();
}

closeButton.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', (event) => {
	if (event.target === dialog) {
		dialog.close();
	}
});

dialog.addEventListener('close', () => {
	document.documentElement.classList.remove('nf-continue-dialog-lock');
	dialogOpener?.focus();
});

function notifyTitleClick(item) {
	fragmentElement.dispatchEvent(
		new CustomEvent(CLICK_EVENT, {
			bubbles: true,
			detail: {contentId: item.id, item},
		})
	);
}

function buildCard(item, progress) {
	const card = createElement('article', 'nf-continue-card');

	card.setAttribute('aria-controls', dialogId);
	card.setAttribute('aria-haspopup', 'dialog');
	card.setAttribute('aria-label', `${item.title}, ${progress}% reproducido`);
	card.setAttribute('role', 'listitem');
	card.tabIndex = 0;

	const poster = createElement('div', 'nf-continue-card__poster');
	const url = imageUrl(item);

	if (url) {
		const image = document.createElement('img');

		image.alt = '';
		image.loading = 'lazy';
		image.src = url;
		poster.appendChild(image);
	}

	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const typeName = names.find((name) => TIPOS.includes(normalize(name)));
	const genres = names.filter((name) => !TIPOS.includes(normalize(name)));
	const info = createElement('div', 'nf-continue-card__info');
	const title = createElement('h3', '', item.title);
	const meta = createElement('p', 'nf-continue-card__meta');
	const classification = fieldText(item, FIELDS.clasificacion);

	title.title = item.title;

	if (classification) {
		meta.appendChild(createElement('span', 'nf-continue-card__badge', classification));
	}

	meta.append([fieldText(item, FIELDS.anio), typeName].filter(Boolean).join(' · '));

	const details = createElement('div', 'nf-continue-card__details');

	details.append(meta, createElement('p', 'nf-continue-card__genres', genres.join(' • ')));
	info.append(title, details);

	const progressTrack = createElement('div', 'nf-continue-card__progress');
	const progressFill = createElement('span', 'nf-continue-card__progress-fill');

	progressTrack.setAttribute('aria-label', `${progress}% reproducido`);
	progressTrack.setAttribute('aria-valuemax', '100');
	progressTrack.setAttribute('aria-valuemin', '0');
	progressTrack.setAttribute('aria-valuenow', String(progress));
	progressTrack.setAttribute('role', 'progressbar');
	progressFill.style.width = `${progress}%`;
	progressTrack.appendChild(progressFill);

	card.append(poster, info, progressTrack);

	const activate = () => {
		notifyTitleClick(item);

		if (progress >= MAX_PROGRESS) {
			return;
		}

		openDialog(item, card);
	};

	card.addEventListener('click', activate);
	card.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			activate();
		}
	});

	return card;
}

function showEmpty() {
	track.replaceChildren();
	track.removeAttribute('aria-busy');

	if (!isEditMode) {
		row.hidden = true;

		return;
	}

	row.hidden = false;
	status.textContent = 'La fila aparecerá después de hacer clic en un título y recargar la página.';
	status.hidden = false;
}

function showError(message) {
	row.hidden = false;
	track.replaceChildren();
	track.removeAttribute('aria-busy');
	status.textContent = message;
	status.hidden = false;
}

async function load() {
	const history = readHistory();

	if (!history.length) {
		showEmpty();

		return;
	}

	try {
		const contents = await getContents();
		const byKey = new Map(contents.map((item) => [titleKey(item), item]));
		const resolved = history
			.map((entry) => ({entry, item: byKey.get(entry.key)}))
			.filter(({item}) => Boolean(item));

		if (!resolved.length) {
			showEmpty();

			return;
		}

		// Elimina referencias a contenidos borrados sin alterar el orden MRU.
		writeHistory(resolved.map(({entry}) => entry));
		track.replaceChildren(
			...resolved.map(({entry, item}) => buildCard(item, Number(entry.progress) || PROGRESS_STEP))
		);
		track.removeAttribute('aria-busy');
		status.hidden = true;
		row.hidden = false;
	}
	catch (error) {
		console.error('[Continuar viendo]', error);
		showError('No se pudo cargar Continuar viendo. El detalle está en la consola del navegador.');
	}
}

load();
