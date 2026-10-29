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
const LONG_TITLE_LENGTH = 32;
const EXTRA_LONG_TITLE_LENGTH = 45;

const hero = fragmentElement.querySelector('.nf-hero');
const backdrop = fragmentElement.querySelector('.nf-hero__backdrop');
const content = fragmentElement.querySelector('.nf-hero__content');
const heroTitle = fragmentElement.querySelector('.nf-hero__title');
const heroSynopsis = fragmentElement.querySelector('.nf-hero__synopsis');
const playButton = fragmentElement.querySelector('.nf-hero__button--play');
const infoButton = fragmentElement.querySelector('.nf-hero__button--info');
const skeleton = fragmentElement.querySelector('.nf-hero__skeleton');
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
	skeleton.hidden = true;
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

// El catálogo original asoció a Chihiro una imagen de otra película. La
// corrección viaja como recurso del fragment para que sea igual en cada entorno.
function heroImage(item) {
	if (
		normalize(item.title).includes('viaje de chihiro') &&
		hero.dataset.chihiroBackdrop
	) {
		return hero.dataset.chihiroBackdrop;
	}

	return fieldImage(item, FIELDS.fondo) || fieldImage(item, FIELDS.poster);
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
	const image = heroImage(item);

	if (image) {
		backdrop.addEventListener('load', () => backdrop.classList.add('is-loaded'), {
			once: true,
		});
		backdrop.src = image;
		backdrop.hidden = false;
	}

	const titleLength = item.title.trim().length;

	content.classList.toggle(
		'nf-hero__content--long-title',
		titleLength >= LONG_TITLE_LENGTH
	);
	content.classList.toggle(
		'nf-hero__content--extra-long-title',
		titleLength >= EXTRA_LONG_TITLE_LENGTH
	);
	heroTitle.textContent = item.title;
	heroSynopsis.textContent = fieldText(item, FIELDS.sinopsis);
	skeleton.hidden = true;
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

	dialogImage.src = heroImage(item);
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

// ---------- Modal ----------

// Botón "Mi lista": se agrega desde el JS, el HTML del fragment no cambia
const listButton = createListButton('nf-hero');

dialog.querySelector('.nf-hero__dialog-body').prepend(listButton.wrapper);

// Título que se está mostrando (lo completa load())
let heroItem = null;


// Botón que abrió el modal, para devolverle el foco al cerrarlo
let opener = infoButton;

function openDialog(event) {
	opener = event.currentTarget;

	if (heroItem) {
		listButton.sync(heroItem.id);
	}

	dialog.showModal();
	document.documentElement.classList.add('nf-hero-lock');
	closeButton.focus();
}

// Todavía no hay video para reproducir: "Reproducir" abre la misma ficha
playButton.addEventListener('click', openDialog);
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
	opener.focus();
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

		heroItem = item;
		renderHero(item);
		renderDialog(item);
	}
	catch (error) {
		console.error('[Título destacado]', error);
		showStatus('No se pudo cargar el título destacado. El detalle está en la consola del navegador.');
	}
}

load();
