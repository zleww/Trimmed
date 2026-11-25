// Stock photos for the landing page (free Unsplash licence, list in public/images/CREDITS.md).
// Swap these for the shop's own photos once the owner says yes. Width/height stop the page jumping while they load.

export type Photo = { src: string; alt: string; width: number; height: number }

export const PHOTOS = {
  salonDim: { src: '/images/salon-dim.webp', alt: 'Gold-lit barbershop with tufted leather chairs', width: 1000, height: 1495 },
  chairBrick: { src: '/images/chair-brick.webp', alt: 'Three leather barber chairs in front of a brick wall and mirrors', width: 1300, height: 863 },
  chairSilver: { src: '/images/chair-silver.webp', alt: 'Classic chrome barber chair in a dim shop', width: 1200, height: 1500 },
  clientChair: { src: '/images/client-chair.webp', alt: 'Barber shaving a client leaning back in the chair', width: 1400, height: 933 },
  toolsSlate: { src: '/images/tools-slate.webp', alt: 'Clippers, scissors, a comb and grooming products on a slate mat', width: 1400, height: 933 },
  razorTrim: { src: '/images/razor-trim.webp', alt: 'Barber shaping a fade with a straight razor', width: 900, height: 1348 },
  beardMono: { src: '/images/beard-mono.webp', alt: 'Black and white photo of a beard trim with scissors', width: 1200, height: 1807 },
  scissorCut: { src: '/images/scissor-cut.webp', alt: 'Barber cutting the top with scissors and a comb', width: 1200, height: 1500 },
  shearsComb: { src: '/images/shears-comb.webp', alt: 'Thinning shears and a comb lifting the hair', width: 1200, height: 1800 },
} satisfies Record<string, Photo>

// services have no photos in the database yet: cards take these in turn
export const SERVICE_PHOTOS: Photo[] = [PHOTOS.razorTrim, PHOTOS.scissorCut, PHOTOS.beardMono, PHOTOS.shearsComb, PHOTOS.clientChair, PHOTOS.chairSilver]
