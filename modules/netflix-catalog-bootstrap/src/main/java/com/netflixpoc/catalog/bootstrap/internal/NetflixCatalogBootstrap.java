package com.netflixpoc.catalog.bootstrap.internal;

import com.liferay.asset.kernel.model.AssetCategory;
import com.liferay.asset.kernel.model.AssetCategoryConstants;
import com.liferay.asset.kernel.model.AssetVocabulary;
import com.liferay.asset.kernel.model.AssetVocabularyConstants;
import com.liferay.asset.kernel.service.AssetCategoryLocalService;
import com.liferay.asset.kernel.service.AssetVocabularyLocalService;
import com.liferay.dynamic.data.mapping.model.DDMStructure;
import com.liferay.dynamic.data.mapping.service.DDMStructureLocalService;
import com.liferay.journal.model.JournalArticle;
import com.liferay.portal.kernel.exception.PortalException;
import com.liferay.portal.kernel.log.Log;
import com.liferay.portal.kernel.log.LogFactoryUtil;
import com.liferay.portal.kernel.model.Company;
import com.liferay.portal.kernel.model.Group;
import com.liferay.portal.kernel.model.User;
import com.liferay.portal.kernel.module.framework.ModuleServiceLifecycle;
import com.liferay.portal.kernel.service.ClassNameLocalService;
import com.liferay.portal.kernel.service.CompanyLocalService;
import com.liferay.portal.kernel.service.GroupLocalService;
import com.liferay.portal.kernel.service.ServiceContext;
import com.liferay.portal.kernel.service.UserLocalService;
import com.liferay.portal.kernel.util.LocaleUtil;
import com.liferay.portal.kernel.util.StringUtil;

import java.io.IOException;
import java.io.InputStream;

import java.nio.charset.StandardCharsets;

import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(immediate = true, service = NetflixCatalogBootstrap.class)
public class NetflixCatalogBootstrap {

	@Activate
	protected void activate() {
		try {
			for (Company company : _companyLocalService.getCompanies()) {
				bootstrapCompany(company);
			}
		}
		catch (Exception exception) {
			_log.error("Unable to bootstrap Netflix catalog model", exception);
		}
	}

	protected void bootstrapCompany(Company company) throws Exception {
		Group group = _groupLocalService.fetchGroupByExternalReferenceCode(
			SITE_ERC, company.getCompanyId());

		if (group == null) {
			group = _groupLocalService.fetchFriendlyURLGroup(
				company.getCompanyId(), "/netflix-poc");
		}

		if (group == null) {
			_log.info(
				"Netflix POC site not found for company " +
					company.getCompanyId());

			return;
		}

		User user = _userLocalService.getDefaultUser(company.getCompanyId());
		ServiceContext serviceContext = createServiceContext(
			company.getCompanyId(), group.getGroupId(), user.getUserId());

		ensureVocabularies(group.getGroupId(), user.getUserId(), serviceContext);
		ensureTituloStructure(
			group.getGroupId(), user.getUserId(), serviceContext);
	}

	protected ServiceContext createServiceContext(
		long companyId, long groupId, long userId) {

		ServiceContext serviceContext = new ServiceContext();

		serviceContext.setAddGroupPermissions(true);
		serviceContext.setAddGuestPermissions(true);
		serviceContext.setCompanyId(companyId);
		serviceContext.setScopeGroupId(groupId);
		serviceContext.setUserId(userId);

		return serviceContext;
	}

	protected void ensureTituloStructure(
			long groupId, long userId, ServiceContext serviceContext)
		throws IOException, PortalException {

		long classNameId = _classNameLocalService.getClassNameId(
			JournalArticle.class.getName());

		DDMStructure ddmStructure =
			_ddmStructureLocalService.fetchStructureByExternalReferenceCode(
				TITULO_ERC, groupId, classNameId);

		if (ddmStructure == null) {
			ddmStructure = _ddmStructureLocalService.fetchStructure(
				groupId, classNameId, TITULO_KEY);
		}

		if (ddmStructure != null) {
			_ddmStructureLocalService.addStructureResources(
				ddmStructure, true, true);

			_log.info(
				"Content structure Titulo already exists with ID " +
					ddmStructure.getStructureId() + ". Permissions repaired.");

			return;
		}

		Map<Locale, String> nameMap = localizedMap("Titulo");
		Map<Locale, String> descriptionMap = localizedMap(
			"Modelo de contenido para peliculas y series del POC Netflix.");

		ddmStructure = _ddmStructureLocalService.addStructure(
			TITULO_ERC, userId, groupId, 0, classNameId, TITULO_KEY, nameMap,
			descriptionMap, readResource("titulo-definition.json"), "default",
			serviceContext);

		_ddmStructureLocalService.addStructureResources(
			ddmStructure, true, true);

		_log.info(
			"Created content structure Titulo with ID " +
				ddmStructure.getStructureId() + ". Permissions added.");
	}

	protected void ensureVocabularies(
			long groupId, long userId, ServiceContext serviceContext)
		throws PortalException {

		AssetVocabulary generosVocabulary = ensureVocabulary(
			"generos", "generos", userId, groupId, serviceContext);

		for (String genero : new String[] {
				"Accion", "Animacion", "Aventura", "Ciencia Ficcion", "Comedia",
				"Drama", "Musical", "Romance", "Terror"
			}) {

			ensureCategory(
				"genero-" + normalizeKey(genero), genero,
				generosVocabulary.getVocabularyId(), userId, groupId,
				serviceContext);
		}

		AssetVocabulary tipoVocabulary = ensureVocabulary(
			"tipo", "tipo", userId, groupId, serviceContext);

		ensureCategory(
			"tipo-pelicula", "Pelicula", tipoVocabulary.getVocabularyId(),
			userId, groupId, serviceContext);
		ensureCategory(
			"tipo-serie", "Serie", tipoVocabulary.getVocabularyId(), userId,
			groupId, serviceContext);
	}

	protected AssetCategory ensureCategory(
			String externalReferenceCode, String name, long vocabularyId,
			long userId, long groupId, ServiceContext serviceContext)
		throws PortalException {

		AssetCategory assetCategory =
			_assetCategoryLocalService.fetchAssetCategoryByExternalReferenceCode(
				externalReferenceCode, groupId);

		if (assetCategory != null) {
			return assetCategory;
		}

		for (AssetCategory existingAssetCategory :
				_assetCategoryLocalService.getVocabularyCategories(
					vocabularyId, -1, -1, null)) {

			if (StringUtil.equalsIgnoreCase(
					existingAssetCategory.getName(), name)) {

				return existingAssetCategory;
			}
		}

		return _assetCategoryLocalService.addCategory(
			externalReferenceCode, userId, groupId,
			AssetCategoryConstants.DEFAULT_PARENT_CATEGORY_ID,
			localizedMap(name), Collections.emptyMap(), vocabularyId,
			new String[0], serviceContext);
	}

	protected AssetVocabulary ensureVocabulary(
			String externalReferenceCode, String name, long userId, long groupId,
			ServiceContext serviceContext)
		throws PortalException {

		AssetVocabulary assetVocabulary =
			_assetVocabularyLocalService.fetchAssetVocabularyByExternalReferenceCode(
				externalReferenceCode, groupId);

		if (assetVocabulary != null) {
			return assetVocabulary;
		}

		assetVocabulary = _assetVocabularyLocalService.fetchGroupVocabulary(
			groupId, name);

		if (assetVocabulary != null) {
			return assetVocabulary;
		}

		return _assetVocabularyLocalService.addVocabulary(
			externalReferenceCode, userId, groupId, name, name,
			localizedMap(name), Collections.emptyMap(), "",
			AssetVocabularyConstants.VISIBILITY_TYPE_PUBLIC, serviceContext);
	}

	protected Map<Locale, String> localizedMap(String value) {
		Map<Locale, String> map = new HashMap<>();

		map.put(LocaleUtil.US, value);

		return map;
	}

	protected String normalizeKey(String value) {
		return StringUtil.toLowerCase(value).replace(' ', '-');
	}

	protected String readResource(String name) throws IOException {
		try (InputStream inputStream = getClass().getClassLoader(
			).getResourceAsStream(name)) {

			if (inputStream == null) {
				throw new IOException("Resource not found: " + name);
			}

			return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
		}
	}

	@Reference
	private AssetCategoryLocalService _assetCategoryLocalService;

	@Reference
	private AssetVocabularyLocalService _assetVocabularyLocalService;

	@Reference
	private ClassNameLocalService _classNameLocalService;

	@Reference
	private CompanyLocalService _companyLocalService;

	@Reference
	private DDMStructureLocalService _ddmStructureLocalService;

	@Reference
	private GroupLocalService _groupLocalService;

	@Reference(target = ModuleServiceLifecycle.PORTAL_INITIALIZED, unbind = "-")
	private ModuleServiceLifecycle _moduleServiceLifecycle;

	@Reference
	private UserLocalService _userLocalService;

	private static final Log _log = LogFactoryUtil.getLog(
		NetflixCatalogBootstrap.class);

	private static final String SITE_ERC = "netflix-poc";

	private static final String TITULO_ERC = "titulo";

	private static final String TITULO_KEY = "titulo";

}
