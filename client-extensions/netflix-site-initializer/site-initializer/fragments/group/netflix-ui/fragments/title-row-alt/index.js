// Fila de títulos
// Trae los web contents de la estructura "Título" por la headless API,
// los filtra por Tipo / Género (categorías), los ordena y los pinta como tarjetas.

const STRUCTURE_NAME = 'Título';

// Mismas referencias de campo que usa el Título destacado
const FIELDS = {
	fondo: 'fondo',
	poster: 'poster',
};

// Días durante los cuales un título se marca como "Recién agregado"
const NEW_DAYS = 14;
const PAGE_SIZE = 100;

const row = fragmentElement.querySelector('.nf-row');
const track = fragmentElement.querySelector('.nf-row__track');
const prev = fragmentElement.querySelector('.nf-row__arrow--prev');
const next = fragmentElement.querySelector('.nf-row__arrow--next');
const status = fragmentElement.querySelector('.nf-row__status');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const isEditMode = typeof layoutMode !== 'undefined' && layoutMode === 'edit';

// ---------- Utilidades ----------

function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

async function getJSON(path) {
	const response = await fetch(path, {
		credentials: 'include',
		headers: {
			'Accept': 'application/json',
			'Accept-Language': Liferay.ThemeDisplay.getBCP47LanguageId(),
			'x-csrf-token': Liferay.authToken,
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} al pedir ${path}`);
	}

	return response.json();
}

function fieldImage(item, name) {
	const field = (item.contentFields || []).find((field) => field.name === name);

	return field?.contentFieldValue?.image?.contentUrl || '';
}

function categories(item) {
	return (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
}

function isNew(item) {
	const created = Date.parse(item.datePublished || item.dateCreated);

	return created && Date.now() - created < NEW_DAYS * 24 * 60 * 60 * 1000;
}

// ---------- Datos (con caché compartida) ----------
// En una home hay varias filas (y el hero) pidiendo lo mismo. Guardamos la
// promesa en window para que la estructura y los contenidos se pidan una sola
// vez por carga de página, sin importar cuántos fragments haya.

const cache = (window.__nfStreamingCache = window.__nfStreamingCache || {});

function getStructure() {
	cache.structure =
		cache.structure ||
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

	return cache.structure;
}

async function fetchAllContents(structureId) {
	const items = [];
	let page = 1;
	let lastPage = 1;

	do {
		const data = await getJSON(
			`/o/headless-delivery/v1.0/content-structures/${structureId}/structured-contents` +
				`?page=${page}&pageSize=${PAGE_SIZE}&sort=dateCreated:desc`
		);

		items.push(...data.items);
		lastPage = data.lastPage || 1;
		page++;
	} while (page <= lastPage);

	return items;
}

function getContents() {
	cache.contents =
		cache.contents || getStructure().then((structure) => fetchAllContents(structure.id));

	// Si falla, se limpia para que un reintento (u otra fila) vuelva a pedir
	cache.contents.catch(() => {
		cache.structure = null;
		cache.contents = null;
	});

	return cache.contents;
}

// ---------- Filtro y orden ----------

function selectTitles(items) {
	const genero = normalize(configuration.genero);
	const tipo = configuration.tipo === 'todos' ? '' : normalize(configuration.tipo);
	const max = parseInt(configuration.cardCount, 10) || 20;

	const filtered = items.filter((item) => {
		const names = categories(item).map(normalize);

		return (!genero || names.includes(genero)) && (!tipo || names.includes(tipo));
	});

	// Copia: el array cacheado lo comparten todas las filas
	const sorted = [...filtered];

	if (configuration.orden === 'titulo') {
		sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}));
	}
	else if (configuration.orden === 'azar') {
		for (let i = sorted.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));

			[sorted[i], sorted[j]] = [sorted[j], sorted[i]];
		}
	}

	// "recientes" ya viene ordenado por la API (sort=dateCreated:desc)

	return sorted.slice(0, max);
}

// ---------- Render ----------

function cardImage(item) {
	return configuration.ratio === 'poster'
		? fieldImage(item, FIELDS.poster) || fieldImage(item, FIELDS.fondo)
		: fieldImage(item, FIELDS.fondo) || fieldImage(item, FIELDS.poster);
}

function cardUrl(item) {
	// Requiere un Display Page Template asociado a la estructura
	return item.friendlyUrlPath ? `/w/${item.friendlyUrlPath}` : '#';
}

function createCard(item, index) {
	const li = document.createElement('li');
	const link = document.createElement('a');
	const media = document.createElement('img');
	const title = document.createElement('span');

	li.className = 'nf-row__item';

	link.className = 'nf-card';
	link.href = cardUrl(item);
	link.setAttribute('aria-label', item.title);
	link.dataset.contentId = item.id;

	media.className = 'nf-card__media nf-card__media--placeholder';
	media.alt = '';
	media.decoding = 'async';
	// Las primeras tarjetas visibles cargan ya; el resto, al acercarse
	media.loading = index < 8 ? 'eager' : 'lazy';

	const src = cardImage(item);

	if (src) {
		media.addEventListener('load', () => media.classList.remove('nf-card__media--placeholder'), {
			once: true,
		});
		media.src = src;
	}

	title.className = 'nf-card__title';
	title.textContent = item.title;

	link.appendChild(media);

	if (isNew(item)) {
		const badge = document.createElement('span');

		badge.className = 'nf-card__badge';
		badge.textContent = 'Recién agregado';
		link.appendChild(badge);
	}

	link.appendChild(title);

	// Aviso para otros fragments (ej.: abrir el modal de "Más información")
	link.addEventListener('click', (event) => {
		const detail = {contentId: item.id, item};
		const notified = fragmentElement.dispatchEvent(
			new CustomEvent('nf:titulo-click', {bubbles: true, cancelable: true, detail})
		);

		if (!notified || link.getAttribute('href') === '#') {
			event.preventDefault();
		}
	});

	li.appendChild(link);

	return li;
}

function render(items) {
	const fragment = document.createDocumentFragment();

	items.forEach((item, index) => fragment.appendChild(createCard(item, index)));

	track.replaceChildren(fragment);
	track.scrollLeft = 0;
	row.removeAttribute('aria-busy');
	updateArrows();
}

function showEmpty(message) {
	track.replaceChildren();
	row.removeAttribute('aria-busy');
	updateArrows();

	// En el editor siempre se ve el mensaje, para que el autor sepa qué pasa
	if (configuration.ocultarVacia && !isEditMode) {
		row.hidden = true;

		return;
	}

	status.textContent = message;
	status.hidden = false;
}

// ---------- Flechas ----------

function pageWidth() {
	const item = track.querySelector('.nf-row__item');
	const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
	const visible = parseFloat(getComputedStyle(row).getPropertyValue('--nf-visible')) || 1;

	return item ? (item.offsetWidth + gap) * Math.floor(visible) : track.clientWidth;
}

function updateArrows() {
	const max = track.scrollWidth - track.clientWidth - 1;

	prev.hidden = track.scrollLeft <= 0;
	next.hidden = max <= 0 || track.scrollLeft >= max;
}

prev.addEventListener('click', () => track.scrollBy({left: -pageWidth()}));
next.addEventListener('click', () => track.scrollBy({left: pageWidth()}));
track.addEventListener('scroll', updateArrows, {passive: true});

// ResizeObserver en vez de window.resize: también reacciona a cambios del layout
new ResizeObserver(updateArrows).observe(track);

// ---------- Carga ----------

async function load() {
	try {
		const titles = selectTitles(await getContents());

		if (!titles.length) {
			showEmpty('No hay títulos que coincidan con la configuración.');

			return;
		}

		render(titles);
	}
	catch (error) {
		console.error('[Fila de títulos]', error);
		showEmpty('No se pudieron cargar los títulos. El detalle está en la consola del navegador.');
	}
}

load();