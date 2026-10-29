package com.nttv.rest.application;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import javax.servlet.http.HttpServletRequest;
import javax.ws.rs.Consumes;
import javax.ws.rs.POST;
import javax.ws.rs.Produces;
import javax.ws.rs.core.Application;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.jaxrs.whiteboard.JaxrsWhiteboardConstants;

import com.liferay.petra.string.StringPool;
import com.liferay.portal.kernel.exception.ContactNameException;
import com.liferay.portal.kernel.exception.PortalException;
import com.liferay.portal.kernel.exception.UserEmailAddressException;
import com.liferay.portal.kernel.exception.UserPasswordException;
import com.liferay.portal.kernel.json.JSONArray;
import com.liferay.portal.kernel.json.JSONException;
import com.liferay.portal.kernel.json.JSONFactory;
import com.liferay.portal.kernel.json.JSONObject;
import com.liferay.portal.kernel.log.Log;
import com.liferay.portal.kernel.log.LogFactoryUtil;
import com.liferay.portal.kernel.model.User;
import com.liferay.portal.kernel.model.UserConstants;
import com.liferay.portal.kernel.service.ServiceContext;
import com.liferay.portal.kernel.service.ServiceContextFactory;
import com.liferay.portal.kernel.service.UserLocalService;
import com.liferay.portal.kernel.util.LocaleUtil;
import com.liferay.portal.kernel.util.Portal;
import com.liferay.portal.kernel.util.PrefsProps;
import com.liferay.portal.kernel.util.PropsKeys;
import com.liferay.portal.kernel.util.StringUtil;
import com.liferay.portal.kernel.util.Validator;
import com.liferay.portal.kernel.workflow.WorkflowConstants;
import com.nttv.dtos.UserDTO;
import com.nttv.exceptions.SignInException;

/**
 * @author lantenni
 */
@Component(
	property = {
		JaxrsWhiteboardConstants.JAX_RS_APPLICATION_BASE + "=/sign-in/v1.0",
		JaxrsWhiteboardConstants.JAX_RS_NAME + "=SignIn.Rest",
		"auth.verifier.guest.allowed=true",
		"liferay.access.control.disable=true",
		"liferay.oauth2=false"
	},
	service = Application.class
)
public class CustomSignInApplication extends Application {

	@Override
	public Set<Object> getSingletons() {
		return Collections.<Object>singleton(this);
	}

	@POST
	@Consumes(MediaType.APPLICATION_JSON)
	@Produces(MediaType.APPLICATION_JSON)
	public Response signIn(String body, @Context HttpServletRequest request) {
		try {
			long companyId = _portal.getCompanyId(request);

			_checkRegistrationEnabled(companyId);

			JSONObject jsonObject = _parseBody(body);

			_validate(jsonObject);

			UserDTO userDTO = _toUserDTO(jsonObject);

			// TODO: verificar userDTO.getCaptchaToken() antes de crear el
			// usuario

			User user = _addUser(companyId, userDTO, request);

			return _toCreatedResponse(companyId, user);
		}
		catch (SignInException signInException) {
			return _toErrorResponse(signInException);
		}
		catch (PortalException portalException) {
			return _toErrorResponse(_toSignInException(portalException));
		}
		catch (Exception exception) {
			_log.error("Unable to register user", exception);

			return _toErrorResponse(SignInException.internalError());
		}
	}

	private User _addUser(
			long companyId, UserDTO userDTO, HttpServletRequest request)
		throws PortalException {

		User guestUser = _userLocalService.getGuestUser(companyId);
		Locale locale = _getLocale(userDTO.getLanguageId());

		long creatorUserId = guestUser.getUserId();
		boolean autoPassword = false;
		String password = userDTO.getPassword();
		boolean autoScreenName = true;
		String screenName = StringPool.BLANK;
		String middleName = StringPool.BLANK;
		long prefixListTypeId = 0;
		long suffixListTypeId = 0;
		boolean male = true;
		int birthdayMonth = Calendar.JANUARY;
		int birthdayDay = 1;
		int birthdayYear = 1970;
		String jobTitle = StringPool.BLANK;
		long[] groupIds = new long[0];
		long[] organizationIds = new long[0];

		// Sin roles: "User" es implícito para todo usuario regular

		long[] roleIds = new long[0];

		long[] userGroupIds = new long[0];
		boolean sendEmail = true;

		ServiceContext serviceContext = _createServiceContext(
			companyId, locale, request);

		return _userLocalService.addUserWithWorkflow(
			creatorUserId, companyId, autoPassword, password, password,
			autoScreenName, screenName, userDTO.getEmailAddress(), locale,
			userDTO.getGivenName(), middleName, userDTO.getFamilyName(),
			prefixListTypeId, suffixListTypeId, male, birthdayMonth,
			birthdayDay, birthdayYear, jobTitle, UserConstants.TYPE_REGULAR,
			groupIds, organizationIds, roleIds, userGroupIds, sendEmail,
			serviceContext);
	}

	/**
	 * Respeta "Allow strangers to create accounts" (Instance Settings).
	 */
	private void _checkRegistrationEnabled(long companyId)
		throws SignInException {

		if (!_prefsProps.getBoolean(
				companyId, PropsKeys.COMPANY_SECURITY_STRANGERS)) {

			throw SignInException.forbidden(
				"REGISTRATION_DISABLED", "Registration disabled");
		}
	}

	private ServiceContext _createServiceContext(
			long companyId, Locale locale, HttpServletRequest request)
		throws PortalException {

		ServiceContext serviceContext = ServiceContextFactory.getInstance(
			request);

		serviceContext.setCompanyId(companyId);
		serviceContext.setLanguageId(LocaleUtil.toLanguageId(locale));

		// Necesarios para armar los links de los mails de verificación y
		// bienvenida

		serviceContext.setPathMain(_portal.getPathMain());
		serviceContext.setPortalURL(_portal.getPortalURL(request));

		serviceContext.setRemoteAddr(request.getRemoteAddr());
		serviceContext.setRemoteHost(request.getRemoteHost());

		return serviceContext;
	}

	private Locale _getLocale(String languageId) {
		languageId = StringUtil.trim(languageId);

		if (Validator.isNotNull(languageId)) {

			// validate=true descarta locales no habilitados en la instancia

			Locale locale = LocaleUtil.fromLanguageId(languageId, true, false);

			if (locale != null) {
				return locale;
			}
		}

		return LocaleUtil.getSiteDefault();
	}

	private String _getTrimmedString(JSONObject jsonObject, String key) {
		return StringUtil.trim(jsonObject.getString(key));
	}

	/**
	 * Valida que el body exista y sea un objeto JSON, antes de deserializar.
	 */
	private JSONObject _parseBody(String body) throws SignInException {
		if (Validator.isNull(body)) {
			throw SignInException.badRequest(
				"MALFORMED_JSON", "Request body is empty");
		}

		try {
			return _jsonFactory.createJSONObject(body);
		}
		catch (JSONException jsonException) {
			if (_log.isDebugEnabled()) {
				_log.debug(jsonException);
			}

			throw SignInException.badRequest(
				"MALFORMED_JSON", "Request body is not valid JSON");
		}
	}

	private Response _toCreatedResponse(long companyId, User user) {
		String nextStep = "LOGIN";
		String status = "ACTIVE";

		if (user.getStatus() == WorkflowConstants.STATUS_PENDING) {
			nextStep = "WAIT_APPROVAL";
			status = "PENDING_APPROVAL";
		}
		else if (_prefsProps.getBoolean(
					companyId, PropsKeys.COMPANY_SECURITY_STRANGERS_VERIFY) &&
				 !user.isEmailAddressVerified()) {

			nextStep = "VERIFY_EMAIL";
			status = "PENDING_VERIFICATION";
		}

		JSONObject jsonObject = _jsonFactory.createJSONObject(
		).put(
			"emailAddress", user.getEmailAddress()
		).put(
			"nextStep", nextStep
		).put(
			"status", status
		).put(
			"userId", user.getUserId()
		);

		return Response.status(
			Response.Status.CREATED
		).entity(
			jsonObject.toString()
		).build();
	}

	private Response _toErrorResponse(SignInException signInException) {
		JSONArray errorsJSONArray = _jsonFactory.createJSONArray();

		for (SignInException.FieldError fieldError :
				signInException.getFieldErrors()) {

			errorsJSONArray.put(
				_jsonFactory.createJSONObject(
				).put(
					"code", fieldError.getCode()
				).put(
					"field", fieldError.getField()
				).put(
					"message", fieldError.getMessage()
				));
		}

		Response.Status status = signInException.getStatus();

		JSONObject jsonObject = _jsonFactory.createJSONObject(
		).put(
			"code", signInException.getCode()
		).put(
			"errors", errorsJSONArray
		).put(
			"status", status.getStatusCode()
		).put(
			"title", signInException.getTitle()
		);

		return Response.status(
			status
		).entity(
			jsonObject.toString()
		).build();
	}

	/**
	 * Traduce las excepciones de Liferay al contrato de la API.
	 */
	private SignInException _toSignInException(
		PortalException portalException) {

		if (portalException instanceof
				UserEmailAddressException.MustNotBeDuplicate) {

			return SignInException.conflict(
				"EMAIL_ALREADY_REGISTERED",
				"The email address is already registered");
		}

		if (portalException instanceof UserEmailAddressException) {
			return SignInException.fieldError(
				"emailAddress", "INVALID_EMAIL", "Invalid email address");
		}

		if (portalException instanceof UserPasswordException.MustBeLonger) {
			return SignInException.fieldError(
				"password", "PASSWORD_TOO_SHORT", "The password is too short");
		}

		if (portalException instanceof UserPasswordException) {
			return SignInException.fieldError(
				"password", "PASSWORD_INVALID",
				"The password does not meet the password policy");
		}

		if (portalException instanceof ContactNameException) {
			return SignInException.fieldError(
				"givenName", "INVALID_NAME", "Invalid name");
		}

		_log.error("Unable to register user", portalException);

		return SignInException.internalError();
	}

	/**
	 * Deserializa el body ya validado y normaliza sus valores. La contraseña
	 * nunca se trimea.
	 */
	private UserDTO _toUserDTO(JSONObject jsonObject) {
		UserDTO userDTO = _jsonFactory.looseDeserialize(
			jsonObject.toString(), UserDTO.class);

		userDTO.setEmailAddress(
			StringUtil.toLowerCase(
				StringUtil.trim(userDTO.getEmailAddress())));
		userDTO.setFamilyName(StringUtil.trim(userDTO.getFamilyName()));
		userDTO.setGivenName(StringUtil.trim(userDTO.getGivenName()));

		return userDTO;
	}

	/**
	 * Junta todos los errores de campo y los lanza juntos, para que el
	 * fragment pueda marcarlos todos de una vez.
	 */
	private void _validate(JSONObject jsonObject) throws SignInException {
		List<SignInException.FieldError> fieldErrors = new ArrayList<>();

		if (Validator.isNull(_getTrimmedString(jsonObject, "givenName"))) {
			fieldErrors.add(
				new SignInException.FieldError(
					"givenName", "REQUIRED", "First name is required"));
		}

		if (Validator.isNull(_getTrimmedString(jsonObject, "familyName"))) {
			fieldErrors.add(
				new SignInException.FieldError(
					"familyName", "REQUIRED", "Last name is required"));
		}

		String emailAddress = _getTrimmedString(jsonObject, "emailAddress");

		if (Validator.isNull(emailAddress)) {
			fieldErrors.add(
				new SignInException.FieldError(
					"emailAddress", "REQUIRED", "Email address is required"));
		}
		else if (!Validator.isEmailAddress(emailAddress)) {
			fieldErrors.add(
				new SignInException.FieldError(
					"emailAddress", "INVALID_EMAIL", "Invalid email address"));
		}

		// Las reglas de la política (largo, complejidad) las valida Liferay

		if (Validator.isNull(jsonObject.getString("password"))) {
			fieldErrors.add(
				new SignInException.FieldError(
					"password", "REQUIRED", "Password is required"));
		}

		if (!jsonObject.getBoolean("acceptTerms")) {
			fieldErrors.add(
				new SignInException.FieldError(
					"acceptTerms", "TERMS_NOT_ACCEPTED",
					"You must accept the terms and conditions"));
		}

		if (!fieldErrors.isEmpty()) {
			throw SignInException.validation(fieldErrors);
		}
	}

	private static final Log _log = LogFactoryUtil.getLog(
		CustomSignInApplication.class);

	@Reference
	private JSONFactory _jsonFactory;

	@Reference
	private Portal _portal;

	@Reference
	private PrefsProps _prefsProps;

	@Reference
	private UserLocalService _userLocalService;

}