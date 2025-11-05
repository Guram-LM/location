import { useState } from "react";
import { MapPin, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface FormData {
  country: string;
  city: string;
  street: string;
  number: string;
}

interface ValidationResult {
  valid: boolean;
  formatted_address?: string;
  errors?: Record<string, string>;
}

interface ReverseGeocodeResponse {
  country?: string;
  city?: string;
  street?: string;
  number?: string;
}

const t = {
  ka: {
    title: "მისამართის ვალიდაცია",
    autoLocation: "ავტომატური ლოკაცია",
    manualInput: "ხელით შეყვანა",
    country: "ქვეყანა",
    city: "ქალაქი",
    street: "ქუჩა",
    number: "ნომერი",
    validate: "მისამართის შემოწმება",
    validAddress: "მისამართი ვალიდურია",
    invalidAddress: "მისამართი არავალიდურია",
    formattedAddress: "დამუშავებული მისამართი",
    detecting: "ლოკაციის აღმოჩენა...",
    locationError: "ვერ მოხერხდა ლოკაციის აღმოჩენა",
    serverError: "სერვერთან დაკავშირება ვერ მოხერხდა",
  },
  en: {
    title: "Address Validation",
    autoLocation: "Automatic Location",
    manualInput: "Manual Input",
    country: "Country",
    city: "City",
    street: "Street",
    number: "Number",
    validate: "Validate Address",
    validAddress: "Address is valid",
    invalidAddress: "Address is invalid",
    formattedAddress: "Formatted Address",
    detecting: "Detecting location...",
    locationError: "Failed to detect location",
    serverError: "Failed to connect to server",
  },
};

export default function App() {
  const [lang, setLang] = useState<"ka" | "en">("ka");
  const [useAutoLocation, setUseAutoLocation] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [form, setForm] = useState<FormData>({
    country: "",
    city: "",
    street: "",
    number: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const getText = (key: keyof typeof t.ka): string => t[lang][key];

  const toggleLang = () => setLang(lang === "ka" ? "en" : "ka");

  const detectLocation = async () => {
    setLoadingLocation(true);
    setErrors({});
    setResult(null);

    if (!navigator.geolocation) {
      alert(getText("locationError"));
      setLoadingLocation(false);
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 60000,
          enableHighAccuracy: true,
        });
      });

      const { latitude, longitude } = position.coords;

      const response = await fetch("http://localhost:4000/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude, lang }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data: ReverseGeocodeResponse = await response.json();

      setForm({
        country: data.country || "",
        city: data.city || "",
        street: data.street || "",
        number: data.number || "",
      });

      setUseAutoLocation(true);
    } catch (error) {
      console.error("Geolocation error:", error);
      alert(getText("locationError"));
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    setResult(null);

    try {
      const response = await fetch("http://localhost:4000/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, lang }),
      });

      const data: ValidationResult = await response.json();

      if (data.valid) {
        setResult(data);
      } else {
        setErrors(data.errors || {});
        setResult(data);
      }
    } catch (error) {
      console.error("Validation error:", error);
      alert(getText("serverError"));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setUseAutoLocation(false);
    setForm({ country: "", city: "", street: "", number: "" });
    setErrors({});
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl rounded-3xl p-8 w-full max-w-lg">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">{getText("title")}</h1>
          <button
            onClick={toggleLang}
            className="text-sm bg-indigo-600 text-white rounded-lg px-4 py-2 hover:bg-indigo-700 transition"
          >
            {lang === "ka" ? "English" : "ქართული"}
          </button>
        </div>

        <div className="mb-6 flex gap-3">
          <button
            onClick={detectLocation}
            disabled={loadingLocation}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white rounded-xl py-3 hover:bg-green-700 transition disabled:opacity-50"
          >
            {loadingLocation ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {getText("detecting")}
              </>
            ) : (
              <>
                <MapPin className="w-5 h-5" />
                {getText("autoLocation")}
              </>
            )}
          </button>
          <button
            onClick={resetForm}
            className="flex-1 bg-gray-600 text-white rounded-xl py-3 hover:bg-gray-700 transition"
          >
            {getText("manualInput")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {["country", "city", "street", "number"].map((field) => (
            <div key={field}>
              <input
                name={field}
                value={form[field as keyof FormData]}
                onChange={handleChange}
                placeholder={getText(field as keyof typeof t.ka)}
                className={`w-full border-2 rounded-xl p-3 transition ${
                  errors[field] ? "border-red-500" : "border-gray-300"
                } focus:border-indigo-500 focus:outline-none`}
                disabled={useAutoLocation && loadingLocation}
              />
              {errors[field] && (
                <div className="flex items-center gap-2 mt-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {errors[field]}
                </div>
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2 font-semibold"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {getText("validate")}
              </>
            ) : (
              getText("validate")
            )}
          </button>
        </form>

        {result && (
          <div className="mt-6 border-t-2 pt-6">
            {result.valid ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-green-700 font-semibold mb-2">
                  <CheckCircle className="w-6 h-6" />
                  {getText("validAddress")}
                </div>
                {result.formatted_address && (
                  <p className="text-sm text-gray-700 mt-2">
                    <strong>{getText("formattedAddress")}:</strong>
                    <br />
                    {result.formatted_address}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-700 font-semibold">
                  <XCircle className="w-6 h-6" />
                  {getText("invalidAddress")}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}