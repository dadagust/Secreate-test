export function demoIdempotencyKey(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid demo seed slug: ${slug}`)
  return `secreate-demo-v1-${slug}`
}

export async function createSeedTask({ owner, slug, title, fault, setFaultMode, postTask }) {
  // A seed-owned idempotency key is the identity; titles are display data and may collide.
  await setFaultMode(fault)
  const task = await postTask(owner, demoIdempotencyKey(slug), title)
  if (!task?.id || task.title !== title) throw new Error(`Seed API returned an unexpected task for ${slug}`)
  return { id: task.id }
}
