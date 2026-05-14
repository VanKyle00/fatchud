export type LatLng = { lat: number; lng: number };

export type GeocodeResult = {
  location: LatLng;
  formattedAddress: string;
};

export type Restaurant = {
  id: string;
  name: string;
  location: LatLng;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  primaryType: string | null;
  types: string[];
  openNow: boolean | null;
  photoName: string | null;
  websiteUri: string | null;
  delivery: boolean | null;
};

export type FilterState = {
  minRating: number;
  cuisines: string[];
  maxPrice: 1 | 2 | 3 | 4;
  openNow: boolean;
};
