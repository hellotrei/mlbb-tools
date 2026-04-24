import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent }) => {
  const { heroes } = await parent();
  return { heroes };
};
