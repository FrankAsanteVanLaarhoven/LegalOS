export async function bad(formData: FormData) {
  return { who: formData.actorId, org: formData.organisationId };
}
