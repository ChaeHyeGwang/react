/** API 응답을 UI 표시용 필드로 정규화 */
export const normalizeCommunityRow = (row) => ({
  ...row,
  user_id: row.account_id_site ?? row.user_id ?? '',
  path: row.referral_path ?? row.path ?? '',
  category: row.category ?? ''
});

/** 커뮤니티 PUT/POST API 페이로드 생성 */
export const buildCommunityApiPayload = (community, overrides = {}) => {
  const merged = { ...community, ...overrides };

  if (overrides.user_id !== undefined) {
    merged.account_id_site = overrides.user_id;
  }
  if (overrides.path !== undefined) {
    merged.referral_path = overrides.path;
  }

  const siteAccountId = (
    merged.account_id_site ??
    merged.user_id ??
    ''
  ).toString().trim();

  return {
    site_name: (merged.site_name || '').trim(),
    domain: merged.domain || '',
    referral_path: merged.referral_path ?? merged.path ?? '',
    referral_code: merged.referral_code || '',
    approval_call: !!merged.approval_call,
    identity_name: merged.identity_name || '',
    account_id: siteAccountId,
    password: merged.password || '',
    exchange_password: merged.exchange_password || '',
    nickname: merged.nickname || '',
    status: merged.status || '가입전',
    notes: merged.notes || '',
    category: merged.category || ''
  };
};

/** 인라인 편집 후 로컬 상태 반영 */
export const applyCommunityFieldUpdate = (community, field, value) => {
  const updates = { [field]: value };
  if (field === 'user_id') updates.account_id_site = value;
  if (field === 'path') updates.referral_path = value;
  return normalizeCommunityRow({ ...community, ...updates });
};
