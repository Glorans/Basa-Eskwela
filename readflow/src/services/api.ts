import axios from "axios";
import { getApiUrl } from "../lib/apiUrl";

const api = axios.create({
  baseURL: getApiUrl(),
});

export default api;