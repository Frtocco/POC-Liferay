// Título destacado
// Elige un contenido del Content Type "Título" (uno fijo o uno al azar),
// lo muestra a pantalla casi completa y, con "Más información", abre un modal
// con el título, los datos principales y la sinopsis.

const STRUCTURE_NAME = 'Título';

// Referencias de campo configuradas en la estructura
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

const backdrop = fragmentElement.querySelector('.nf-hero__backdrop');
const content = fragmentElement.querySelector('.nf-hero__content');
const heroTitle = fragmentElement.querySelector('.nf-hero__title');
const heroSynopsis = fragmentElement.querySelector('.nf-hero__synopsis');
const infoButton = fragmentElement.querySelector('.nf-hero__button');
const status = fragmentElement.querySelector('.nf-hero__status');

const dialog = fragmentElement.querySelector('.nf-hero__dialog');
const dialogImage = fragmentElement.querySelector('.nf-hero__dialog-image');
const dialogTitle = fragmentElement.querySelector('.nf-hero__dialog-title');
const dialogMeta = fragmentElement.querySelector('.nf-hero__dialog-meta');
const dialogSynopsis = fragmentElement.querySelector('.nf-hero__dialog-synopsis');
const closeButton = fragmentElement.querySelector('.nf-hero__dialog-close');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();

// Id único para que el modal anuncie su título a los lectores de pantalla
dialogTitle.id = `nf-hero-title-${Math.random().toString(36).slice(2, 8)}`;
dialog.setAttribute('aria-labelledby', dialogTitle.id);

// ---------- Utilidades ----------

function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
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

function showStatus(message) {
	status.textContent = message;
	status.hidden = false;
}

// Un campo repetible (como elenco) aparece varias veces con el mismo nombre
function fieldValues(item, name) {
	return (item.contentFields || [])
		.filter((field) => field.name === name)
		.map((field) => field.contentFieldValue)
		.filter(Boolean);
}

function fieldText(item, name) {
	const value = fieldValues(item, name)[0];

	return value?.data ? String(value.data).trim() : '';
}

function fieldImage(item, name) {
	return fieldValues(item, name)[0]?.image?.contentUrl || '';
}

function categories(item) {
	return (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
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

// ---------- Elección del título ----------

function pickTitle(items) {
	const destacado = normalize(configuration.tituloDestacado);

	if (destacado) {
		const match = items.find((item) => normalize(item.title) === destacado);

		if (match) {
			return match;
		}

		console.warn(
			`[Título destacado] No se encontró "${configuration.tituloDestacado}". Se elige uno al azar.`
		);
	}

	const genero = normalize(configuration.genero);
	const tipo = configuration.tipo === 'todos' ? '' : normalize(configuration.tipo);

	const candidates = items.filter((item) => {
		const names = categories(item).map(normalize);

		return (!genero || names.includes(genero)) && (!tipo || names.includes(tipo));
	});

	if (!candidates.length) {
		return null;
	}

	return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------- Render ----------

function renderHero(item) {
	const image = fieldImage(item, FIELDS.fondo) || fieldImage(item, FIELDS.poster);

	if (image) {
		backdrop.addEventListener('load', () => backdrop.classList.add('is-loaded'), {
			once: true,
		});
		backdrop.src = image;
		backdrop.hidden = false;
	}

	heroTitle.textContent = item.title;
	heroSynopsis.textContent = fieldText(item, FIELDS.sinopsis);
	content.hidden = false;
}

function addMeta(text, badge = false) {
	if (!text) {
		return;
	}

	const entry = document.createElement('li');

	entry.textContent = text;

	if (badge) {
		entry.className = 'nf-hero__badge';
	}

	dialogMeta.appendChild(entry);
}

function setExtra(field, values) {
	const row = fragmentElement.querySelector(`.nf-hero__dialog-extra[data-field="${field}"]`);

	row.querySelector('.nf-hero__dialog-value').textContent = values.join(', ');
	row.hidden = !values.length;
}

function renderDialog(item) {
	const names = categories(item);
	const esSerie = names.some((name) => normalize(name) === 'serie');

	dialogImage.src = fieldImage(item, FIELDS.fondo) || fieldImage(item, FIELDS.poster);
	dialogTitle.textContent = item.title;
	dialogSynopsis.textContent = fieldText(item, FIELDS.sinopsis);

	dialogMeta.replaceChildren();
	addMeta(fieldText(item, FIELDS.anio));
	addMeta(fieldText(item, FIELDS.clasificacion), true);

	if (esSerie) {
		const temporadas = parseInt(fieldText(item, FIELDS.temporadas), 10);

		addMeta(temporadas ? `${temporadas} ${temporadas === 1 ? 'temporada' : 'temporadas'}` : '');
	}
	else {
		addMeta(formatDuration(fieldText(item, FIELDS.duracion)));
	}

	const elenco = fieldValues(item, FIELDS.elenco)
		.map((value) => String(value.data || '').trim())
		.filter(Boolean);

	// Las categorías de Tipo (Película / Serie) no se muestran como géneros
	const generos = names.filter((name) => !TIPOS.includes(normalize(name)));

	setExtra('elenco', elenco);
	setExtra('generos', generos);
}

// ---------- Modal ----------

function openDialog() {
	dialog.showModal();
	document.documentElement.classList.add('nf-hero-lock');
	closeButton.focus();
}

infoButton.addEventListener('click', openDialog);
closeButton.addEventListener('click', () => dialog.close());

// Clic en el fondo oscuro: el evento llega al <dialog> y no a su contenido
dialog.addEventListener('click', (event) => {
	if (event.target === dialog) {
		dialog.close();
	}
});

// Escape cierra el modal de forma nativa; en cualquier cierre se libera el scroll
dialog.addEventListener('close', () => {
	document.documentElement.classList.remove('nf-hero-lock');
	infoButton.focus();
});

// ---------- Carga ----------

async function load() {
	try {
		const structures = await getJSON(
			`/o/headless-delivery/v1.0/sites/${siteId}/content-structures?pageSize=100`
		);

		const structure = structures.items.find(
			(item) => normalize(item.name) === normalize(STRUCTURE_NAME)
		);

		if (!structure) {
			showStatus(`No existe el Content Type "${STRUCTURE_NAME}" en este sitio.`);

			return;
		}

		const contents = await getJSON(
			`/o/headless-delivery/v1.0/content-structures/${structure.id}/structured-contents?pageSize=100`
		);

		const item = pickTitle(contents.items);

		if (!item) {
			showStatus('No hay títulos que coincidan con la configuración.');

			return;
		}

		renderHero(item);
		renderDialog(item);
	}
	catch (error) {
		console.error('[Título destacado]', error);
		showStatus('No se pudo cargar el título destacado. El detalle está en la consola del navegador.');
	}
}

load();
