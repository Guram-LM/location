// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import NodeCache from "node-cache";

dotenv.config();

const app = express();
const cache = new NodeCache({ stdTTL: 60 * 60 * 24 }); // 24h cache

app.use(cors());
app.use(express.json());

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY is missing in .env file!");
  process.exit(1);
}

// შეცდომის შეტყობინებები
const errorMessages = {
  ka: {
    required: "სავალდებულო ველი",
    invalidCountry: "ქვეყანა არასწორია",
    invalidCity: "ქალაქი არასწორია",
    invalidStreet: "ქუჩა არასწორია",
    invalidNumber: "ნომერი არასწორია",
    addressNotFound: "მისამართი ვერ მოიძებნა",
    partialMatch: "მისამართი ნაწილობრივია",
    notRooftop: "მისამართი არ არის ზუსტი",
  },
  en: {
    required: "Required field",
    invalidCountry: "Invalid country",
    invalidCity: "Invalid city",
    invalidStreet: "Invalid street",
    invalidNumber: "Invalid number",
    addressNotFound: "Address not found",
    partialMatch: "Address is partial",
    notRooftop: "Address is not precise",
  },
};

// სტრიქონის ნორმალიზაცია
const normalize = (str) => str.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

// კომპონენტის მოძებნა
const findComponent = (components, types) => {
  return components.find(c => types.some(t => c.types.includes(t)));
};

// === მისამართის ვალიდაცია ===
app.post("/validate", async (req, res) => {
  const { country, city, street, number, lang = "ka" } = req.body;
  const msg = errorMessages[lang] || errorMessages.ka;
  const errors = {};

  if (!country?.trim()) errors.country = msg.required;
  if (!city?.trim()) errors.city = msg.required;
  if (!street?.trim()) errors.street = msg.required;
  if (!number?.toString().trim()) errors.number = msg.required;

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ valid: false, errors });
  }

  const fullAddress = `${street} ${number}, ${city}, ${country}`;
  const encoded = encodeURIComponent(fullAddress);

  let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${GOOGLE_API_KEY}&language=${lang}`;
  let data = await (await fetch(url)).json();

  if (data.status !== "OK" || !data.results?.length) {
    url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${GOOGLE_API_KEY}&language=en`;
    data = await (await fetch(url)).json();
  }

  if (data.status !== "OK" || !data.results?.length) {
    return res.json({ valid: false, message: msg.addressNotFound });
  }

  const result = data.results[0];
  const components = result.address_components;

  const countryComp = findComponent(components, ["country"]);
  const cityComp = findComponent(components, ["locality", "administrative_area_level_2", "administrative_area_level_1"]);
  const streetComp = findComponent(components, ["route", "street_address"]);
  const numberComp = findComponent(components, ["street_number", "premise"]);

  if (!countryComp || 
      (!normalize(countryComp.long_name).includes(normalize(country)) && 
       !normalize(countryComp.short_name).includes(normalize(country)))) {
    errors.country = msg.invalidCountry;
  }

  if (!cityComp || !normalize(cityComp.long_name).includes(normalize(city))) {
    errors.city = msg.invalidCity;
  }

  if (!streetComp || !normalize(streetComp.long_name).includes(normalize(street))) {
    errors.street = msg.invalidStreet;
  }

  if (!numberComp || !normalize(numberComp.long_name).includes(normalize(number))) {
    errors.number = msg.invalidNumber;
  }

  const isRooftop = result.geometry.location_type === "ROOFTOP";
  const isStreetAddress = result.types.includes("street_address") || result.types.includes("premise");
  const noPartial = !result.partial_match;

  const valid = Object.keys(errors).length === 0 && isRooftop && isStreetAddress && noPartial;

  res.json({
    valid,
    formatted_address: result.formatted_address,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    geometry_type: result.geometry.location_type,
    partial: !!result.partial_match,
    types: result.types,
  });
});

// === REVERSE GEOCODE (სრულად გამოსწორებული) ===
app.post("/reverse-geocode", async (req, res) => {
  const { latitude, longitude, lang = "ka" } = req.body;
  const cacheKey = `rev_${latitude}_${longitude}_${lang}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Missing coordinates" });
  }

  let url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_API_KEY}&language=${lang}`;
  let data = await (await fetch(url)).json();

  if (data.status !== "OK" || !data.results?.length) {
    url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_API_KEY}&language=en`;
    data = await (await fetch(url)).json();
  }

  if (data.status !== "OK" || !data.results?.length) {
    return res.status(404).json({ error: "Location not found" });
  }

  // აირჩიეთ ყველაზე ზუსტი
  const sorted = data.results.sort((a, b) => {
    const order = ["ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER", "APPROXIMATE"];
    return order.indexOf(a.geometry.location_type) - order.indexOf(b.geometry.location_type);
  });

  const result = sorted[0];
  const components = result.address_components;
  const formatted = result.formatted_address || "";

  const get = (types) => {
    const c = components.find(comp => types.some(t => comp.types.includes(t)));
    return c ? c.long_name : "";
  };

  // 1. components-დან (სანდო)
  let country = get(["country"]);
  let city = get(["locality"]) || get(["administrative_area_level_2"]) || get(["administrative_area_level_1"]);
  let street = get(["route"]) || get(["neighborhood"]) || get(["sublocality"]);
  let number = get(["street_number"]) || get(["premise"]);

  // 2. თუ ქუჩა ან ნომერი არ არის — formatted_address-დან
  if (!street || !number) {
    const parts = formatted.split(",").map(p => p.trim());

    // თუ არის მინიმუმ 3 ნაწილი: "ქუჩა 12, ქალაქი, ქვეყანა"
    if (parts.length >= 3) {
      const firstPart = parts[0];
      const match = firstPart.match(/^(.+?)\s+([\d]+[a-zA-Z]?)$/);
      if (match) {
        street = match[1].trim();
        number = match[2].trim();
      } else {
        street = firstPart;
        number = "";
      }
    }
    // თუ მხოლოდ 2 ნაწილია: "ქუჩა 12, ქვეყანა" → ქალაქი ცარიელი
    else if (parts.length === 2) {
      const firstPart = parts[0];
      const match = firstPart.match(/^(.+?)\s+([\d]+[a-zA-Z]?)$/);
      if (match) {
        street = match[1].trim();
        number = match[2].trim();
      } else {
        street = firstPart;
        number = "";
      }
    }
    // თუ მხოლოდ 1 ნაწილია — არაფერს არ ვწერთ ქუჩად
  }

  // 3. ქვეყანა short_name-ით
  if (!country) {
    const countryComp = components.find(c => c.types.includes("country"));
    country = countryComp?.short_name || "";
  }

  const responseData = {
    country: country || "საქართველო",
    city: city || "",
    street: street || "",
    number: number || "",
    formatted_address: formatted,
    location_type: result.geometry.location_type,
  };

  cache.set(cacheKey, responseData);
  res.json(responseData);
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "OK", endpoints: ["/validate", "/reverse-geocode"] });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`POST /validate  → Address validation`);
  console.log(`POST /reverse-geocode → Auto location`);
});