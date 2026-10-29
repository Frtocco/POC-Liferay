// Fila de títulos
// Busca los contenidos del Content Type "Título" del sitio y muestra los que
// tienen la categoría de género configurada (y opcionalmente la de tipo),
// en orden aleatorio para que la fila cambie en cada carga.
// Liferay inyecta "fragmentElement" (el HTML de este fragment) y
// "configuration" (los valores cargados en el panel de configuración).

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

const row = fragmentElement.querySelector('.nf-row');
const track = fragmentElement.querySelector('.nf-row__track');
const status = fragmentElement.querySelector('.nf-row__status');
const prevButton = fragmentElement.querySelector('.nf-row__nav--prev');
const nextButton = fragmentElement.querySelector('.nf-row__nav--next');
const dialog = fragmentElement.querySelector('.nf-row__dialog');
const dialogImage = fragmentElement.querySelector('.nf-row__dialog-image');
const dialogTitle = fragmentElement.querySelector('.nf-row__dialog-title');
const dialogMeta = fragmentElement.querySelector('.nf-row__dialog-meta');
const dialogSynopsis = fragmentElement.querySelector('.nf-row__dialog-synopsis');
const closeButton = fragmentElement.querySelector('.nf-row__dialog-close');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const popularityStorageKey = `nf-title-popularity:v1:${siteId}`;

const dialogId = `nf-row-dialog-${Math.random().toString(36).slice(2, 8)}`;

dialog.id = dialogId;
dialogTitle.id = `${dialogId}-title`;
dialog.setAttribute('aria-labelledby', dialogTitle.id);

// Compara sin mayúsculas ni tildes: "Comedia" = "comedia", "Película" = "pelicula"
function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

const genero = normalize(configuration.genero);
const tipo = configuration.tipo === 'todos' ? '' : normalize(configuration.tipo);

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
	track.replaceChildren();
	track.removeAttribute('aria-busy');
	status.textContent = message;
	status.hidden = false;
}

function categoryNames(item) {
	return (item.taxonomyCategoryBriefs || []).map((category) =>
		normalize(category.taxonomyCategoryName)
	);
}

// Mezcla la lista al azar (algoritmo Fisher-Yates): recorre el array de atrás
// hacia adelante e intercambia cada elemento con otro elegido al azar entre
// los que todavía no se movieron. Devuelve una copia y no toca el original.
function shuffle(list) {
	const result = [...list];

	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));

		[result[i], result[j]] = [result[j], result[i]];
	}

	return result;
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

// Las cards son horizontales (16:9), por eso usan el fondo horizontal. Los
// pósters son verticales y "cover" los recorta demasiado; quedan como fallback.
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

// ---------- Mi lista (bloque compartido) ----------
// Este bloque es IGUAL en Título destacado, Fila de títulos y Mi lista: si lo
// cambiás en uno, copialo en los otros dos. El primer fragment que corre lo
// publica en window.NetflixMiLista y los demás lo reusan, así todos los
// fragments de la página comparten una sola copia de la lista en memoria y se
// enteran de los cambios con el evento "nf-mi-lista-change".

// Ruta del Object y nombre del campo de la relación Perfil → MiListaItem.
// Se confirman en /o/api → c/milistaitems (POST, schema del body).
const MI_LISTA_API = '/o/c/milistaitems';
const MI_LISTA_RELATION = 'r_miLista_c_perfilId';
const ACTIVE_PROFILE_KEY = 'nf-perfil-activo';
const MI_LISTA_EVENT = 'nf-mi-lista-change';

function createMiLista() {
	// {perfilId, promise} — la promesa resuelve a [{entryId, tituloId}],
	// del más nuevo al más viejo
	let cache = null;

	function perfil() {
		try {
			const value = JSON.parse(sessionStorage.getItem(ACTIVE_PROFILE_KEY) || 'null');

			return value && value.id ? value : null;
		}
		catch (error) {
			return null;
		}
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

		// DELETE responde 204 sin cuerpo
		return response.status === 204 ? null : response.json();
	}

	function entries() {
		const current = perfil();

		if (!current || !Liferay.ThemeDisplay.isSignedIn()) {
			return Promise.resolve([]);
		}

		// Se pide una sola vez por perfil; si cambia el perfil activo, se recarga
		if (!cache || cache.perfilId !== current.id) {
			const filter = encodeURIComponent(`${MI_LISTA_RELATION} eq '${current.id}'`);
			const promise = request(
				`${MI_LISTA_API}?filter=${filter}&pageSize=500&sort=dateCreated:desc`
			).then((data) =>
				(data.items || []).map((entry) => ({
					entryId: entry.id,
					tituloId: String(entry.tituloId),
				}))
			);

			cache = {perfilId: current.id, promise};

			// Si falla, el próximo pedido vuelve a intentar
			promise.catch(() => {
				if (cache?.promise === promise) {
					cache = null;
				}
			});
		}

		return cache.promise;
	}

	async function has(tituloId) {
		const list = await entries();

		return list.some((entry) => entry.tituloId === String(tituloId));
	}

	function notify(tituloId, added) {
		document.dispatchEvent(
			new CustomEvent(MI_LISTA_EVENT, {detail: {added, tituloId: String(tituloId)}})
		);
	}

	async function add(tituloId) {
		const current = perfil();

		if (!current) {
			throw new Error('No hay un perfil activo.');
		}

		const list = await entries();

		if (list.some((entry) => entry.tituloId === String(tituloId))) {
			return;
		}

		const entry = await request(`${MI_LISTA_API}/`, {
			body: {
				[MI_LISTA_RELATION]: Number(current.id),
				tituloId: Number(tituloId),
			},
			method: 'POST',
		});

		// La lista en memoria se actualiza en el lugar: el más nuevo va primero
		list.unshift({entryId: entry.id, tituloId: String(tituloId)});
		notify(tituloId, true);
	}

	async function remove(tituloId) {
		const list = await entries();
		const matches = list.filter((entry) => entry.tituloId === String(tituloId));

		await Promise.all(
			matches.map((entry) =>
				request(`${MI_LISTA_API}/${entry.entryId}`, {method: 'DELETE'})
			)
		);

		matches.forEach((entry) => list.splice(list.indexOf(entry), 1));
		notify(tituloId, false);
	}

	// Devuelve true si quedó agregado, false si quedó quitado
	async function toggle(tituloId) {
		if (await has(tituloId)) {
			await remove(tituloId);

			return false;
		}

		await add(tituloId);

		return true;
	}

	return {add, entries, has, perfil, remove, toggle, version: 1};
}

const miLista = window.NetflixMiLista || (window.NetflixMiLista = createMiLista());

// Arma el botón "Mi lista" de un modal. "block" es el prefijo de clases del
// fragment (nf-hero, nf-row, nf-mylist). El HTML del botón es fijo: el título
// del contenido nunca pasa por innerHTML.
function createListButton(block) {
	const wrapper = document.createElement('div');

	wrapper.className = `${block}__dialog-actions`;
	wrapper.hidden = true;

	const button = document.createElement('button');

	button.className = `${block}__list-button`;
	button.type = 'button';
	button.setAttribute('aria-label', 'Mi lista');
	button.setAttribute('aria-pressed', 'false');
	button.innerHTML = `
		<svg aria-hidden="true" class="${block}__list-icon ${block}__list-icon--plus" viewBox="0 0 24 24">
			<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.5" />
		</svg>
		<svg aria-hidden="true" class="${block}__list-icon ${block}__list-icon--check" viewBox="0 0 24 24">
			<path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" />
		</svg>
		<span class="${block}__list-label">Mi lista</span>`;

	const message = document.createElement('p');

	message.className = `${block}__list-message`;
	message.setAttribute('role', 'status');

	wrapper.append(button, message);

	const label = button.querySelector(`.${block}__list-label`);

	let tituloId = null;
	let busy = false;

	function render(added) {
		button.setAttribute('aria-pressed', String(added));
		button.title = added ? 'Quitar de Mi lista' : 'Agregar a Mi lista';
		label.textContent = added ? 'En mi lista' : 'Mi lista';
	}

	// Se llama cada vez que se abre el modal con un título
	async function sync(id) {
		const current = String(id);

		tituloId = current;
		message.textContent = '';

		// Sin sesión o sin perfil elegido no hay lista a la que agregar
		wrapper.hidden = !Liferay.ThemeDisplay.isSignedIn() || !miLista.perfil();

		if (wrapper.hidden) {
			return;
		}

		render(false);
		busy = true;
		button.setAttribute('aria-busy', 'true');

		try {
			const added = await miLista.has(current);

			// Si mientras tanto se abrió otro título, esta respuesta ya no sirve
			if (tituloId === current) {
				render(added);
			}
		}
		catch (error) {
			console.error('[Mi lista]', error);

			if (tituloId === current) {
				message.textContent = 'No se pudo cargar Mi lista.';
			}
		}
		finally {
			if (tituloId === current) {
				busy = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	// No se usa "disabled" para que el foco no se pierda dentro del modal
	button.addEventListener('click', async () => {
		if (busy || !tituloId) {
			return;
		}

		const current = tituloId;

		busy = true;
		button.setAttribute('aria-busy', 'true');
		message.textContent = '';

		try {
			const added = await miLista.toggle(current);

			if (tituloId === current) {
				render(added);
			}
		}
		catch (error) {
			console.error('[Mi lista]', error);
			message.textContent = 'No se pudo actualizar Mi lista. Probá de nuevo.';
		}
		finally {
			busy = false;
			button.removeAttribute('aria-busy');
		}
	});

	// Si otro fragment de la página cambia este mismo título, el botón se entera
	document.addEventListener(MI_LISTA_EVENT, (event) => {
		if (wrapper.isConnected && event.detail.tituloId === tituloId) {
			render(event.detail.added);
		}
	});

	return {sync, wrapper};
}

// ---------- Modal de detalle ----------

// Botón "Mi lista": se agrega desde el JS, el HTML del fragment no cambia
const listButton = createListButton('nf-row');

dialog.querySelector('.nf-row__dialog-body').prepend(listButton.wrapper);


function addDialogMeta(text, badge = false) {
	if (!text) {
		return;
	}

	const entry = document.createElement('li');

	entry.textContent = text;

	if (badge) {
		entry.className = 'nf-row__dialog-badge';
	}

	dialogMeta.appendChild(entry);
}

function setDialogExtra(field, values) {
	const detail = dialog.querySelector(`.nf-row__dialog-extra[data-field="${field}"]`);

	detail.querySelector('.nf-row__dialog-value').textContent = values.join(', ');
	detail.hidden = !values.length;
}

function renderDialog(item) {
	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const esSerie = names.some((name) => normalize(name) === 'serie');
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

	if (esSerie) {
		const temporadas = parseInt(fieldText(item, FIELDS.temporadas), 10);

		addDialogMeta(
			temporadas ? `${temporadas} ${temporadas === 1 ? 'temporada' : 'temporadas'}` : ''
		);
	}
	else {
		addDialogMeta(formatDuration(fieldText(item, FIELDS.duracion)));
	}

	const elenco = fieldValues(item, FIELDS.elenco)
		.map((value) => String(value.data || '').trim())
		.filter(Boolean);
	const generos = names.filter((name) => !TIPOS.includes(normalize(name)));

	setDialogExtra('elenco', elenco);
	setDialogExtra('generos', generos);
}

let dialogOpener = null;

function openDialog(item, opener) {
	dialogOpener = opener;
	renderDialog(item);
	listButton.sync(item.id);
	dialog.scrollTop = 0;
	dialog.showModal();
	document.documentElement.classList.add('nf-row-dialog-lock');
	closeButton.focus();
}

closeButton.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', (event) => {
	if (event.target === dialog) {
		dialog.close();
	}
});

dialog.addEventListener('close', () => {
	document.documentElement.classList.remove('nf-row-dialog-lock');
	dialogOpener?.focus();
});

function createElement(tagName, className, text) {
	const element = document.createElement(tagName);

	element.className = className;

	if (text) {
		element.textContent = text;
	}

	return element;
}

// Ranking local compartido con el fragmento Tendencias. sessionStorage
// conserva los clicks al recargar la página y los descarta al cerrar la pestaña.
function titleKey(item) {
	if (item.externalReferenceCode) {
		return `erc:${item.externalReferenceCode}`;
	}

	if (item.id) {
		return `id:${item.id}`;
	}

	return `title:${normalize(item.title)}`;
}

function recordClick(item) {
	try {
		const popularity = JSON.parse(
			sessionStorage.getItem(popularityStorageKey) || '{}'
		);
		const key = titleKey(item);
		const previous = popularity[key] || {};

		popularity[key] = {
			clicks: (Number(previous.clicks) || 0) + 1,
			lastClick: Date.now(),
		};

		sessionStorage.setItem(popularityStorageKey, JSON.stringify(popularity));
	}
	catch (error) {
		console.warn('[Fila de títulos] No se pudo guardar el click para Tendencias.', error);
	}
}

// Las cards se arman con createElement (no innerHTML) para no inyectar HTML
// que venga del contenido.
function buildCard(item) {
	const card = createElement('article', 'nf-movie-card');
	card.setAttribute('aria-controls', dialogId);
	card.setAttribute('aria-haspopup', 'dialog');
	card.setAttribute('aria-label', item.title);
	card.setAttribute('role', 'listitem');
	card.tabIndex = 0;

	const poster = createElement('div', 'nf-movie-card__poster');

	const url = imageUrl(item);

	if (url) {
		const image = document.createElement('img');
		image.alt = '';
		image.loading = 'lazy';
		image.src = url;
		poster.appendChild(image);
	}

	const info = createElement('div', 'nf-movie-card__info');

	const title = createElement('h3', '', item.title);
	title.title = item.title;

	// Datos que aparecen en hover / foco: clasificación, año, tipo y géneros
	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const tipoName = names.find((name) => TIPOS.includes(normalize(name)));
	const generos = names.filter((name) => !TIPOS.includes(normalize(name)));

	const meta = createElement('p', 'nf-movie-card__meta');
	const clasificacion = fieldText(item, FIELDS.clasificacion);

	if (clasificacion) {
		meta.appendChild(createElement('span', 'nf-movie-card__badge', clasificacion));
	}

	meta.append([fieldText(item, FIELDS.anio), tipoName].filter(Boolean).join(' · '));

	const details = createElement('div', 'nf-movie-card__details');
	details.append(meta, createElement('p', 'nf-movie-card__genres', generos.join(' • ')));

	info.append(title, details);
	card.append(poster, info);
	card.addEventListener('click', () => {
		recordClick(item);
		openDialog(item, card);
	});
	card.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			recordClick(item);
			openDialog(item, card);
		}
	});

	return card;
}

function updateNav() {
	const maxScroll = track.scrollWidth - track.clientWidth - 1;

	prevButton.disabled = track.scrollLeft <= 0;
	nextButton.disabled = track.scrollLeft >= maxScroll;
}

function scrollRow(direction) {
	track.scrollBy({
		behavior: reduceMotion ? 'auto' : 'smooth',
		left: direction * track.clientWidth * 0.9,
	});
}

async function load() {
	if (!genero) {
		showStatus('Configurá un género para esta fila.');

		return;
	}

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

		const items = contents.items.filter((item) => {
			const categories = categoryNames(item);

			return categories.includes(genero) && (!tipo || categories.includes(tipo));
		});

		if (!items.length) {
			showStatus(`Todavía no hay títulos con el género "${configuration.genero}".`);

			return;
		}

		track.replaceChildren(...shuffle(items).map(buildCard));
		track.removeAttribute('aria-busy');
		updateNav();
	}
	catch (error) {
		console.error('[Fila de títulos]', error);
		showStatus('No se pudieron cargar los títulos. El detalle está en la consola del navegador.');
	}
}

prevButton.addEventListener('click', () => scrollRow(-1));
nextButton.addEventListener('click', () => scrollRow(1));
track.addEventListener('scroll', updateNav, {passive: true});
window.addEventListener('resize', updateNav);

load();
