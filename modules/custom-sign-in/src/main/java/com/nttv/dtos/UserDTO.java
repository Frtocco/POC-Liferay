package com.nttv.dtos;

import com.liferay.petra.string.StringBundler;

/**
 * Request body for POST /o/sign-in/v1.0.
 *
 * @author lantenni
 */
public class UserDTO {

	public String getCaptchaToken() {
		return _captchaToken;
	}

	public String getEmailAddress() {
		return _emailAddress;
	}

	public String getFamilyName() {
		return _familyName;
	}

	public String getGivenName() {
		return _givenName;
	}

	public String getLanguageId() {
		return _languageId;
	}

	public String getPassword() {
		return _password;
	}

	public boolean isAcceptTerms() {
		return _acceptTerms;
	}

	public void setAcceptTerms(boolean acceptTerms) {
		_acceptTerms = acceptTerms;
	}

	public void setCaptchaToken(String captchaToken) {
		_captchaToken = captchaToken;
	}

	public void setEmailAddress(String emailAddress) {
		_emailAddress = emailAddress;
	}

	public void setFamilyName(String familyName) {
		_familyName = familyName;
	}

	public void setGivenName(String givenName) {
		_givenName = givenName;
	}

	public void setLanguageId(String languageId) {
		_languageId = languageId;
	}

	public void setPassword(String password) {
		_password = password;
	}

	/**
	 * Password and CAPTCHA token are masked so the DTO can be logged safely.
	 */
	@Override
	public String toString() {
		StringBundler sb = new StringBundler(12);

		sb.append("{acceptTerms=");
		sb.append(_acceptTerms);
		sb.append(", captchaToken=***");
		sb.append(", emailAddress=");
		sb.append(_emailAddress);
		sb.append(", familyName=");
		sb.append(_familyName);
		sb.append(", givenName=");
		sb.append(_givenName);
		sb.append(", languageId=");
		sb.append(_languageId);
		sb.append(", password=***}");

		return sb.toString();
	}

	private boolean _acceptTerms;
	private String _captchaToken;
	private String _emailAddress;
	private String _familyName;
	private String _givenName;
	private String _languageId;
	private String _password;

}