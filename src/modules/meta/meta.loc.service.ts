import { State, City } from "country-state-city"
import { INDIA_STATE_CODES } from "../../constants/constants";

export class LocationService {
    static async getIndianStates() {
        return State.getStatesOfCountry("IN").map((state) => ({
            name: state.name,
            isoCode: state.isoCode,
            stateCode:
                INDIA_STATE_CODES[
                    state.name.trim().toUpperCase()
                ] || null,
        }));
    }

    static async getCitiesByState(stateIsoCode: string) {

        if (!stateIsoCode) {
            throw new Error("State ISO Code is required");
        }

        return City.getCitiesOfState(
            "IN",
            stateIsoCode
        ).map((city) => ({
            name: city.name,
        }));
    }
}