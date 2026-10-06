import unittest

from backend.physics import Storm, destination, holland_b, pressure_hpa, simulate, tangential_wind_ms, wind_vector_ms


class PhysicsTests(unittest.TestCase):
    def setUp(self):
        self.storm = Storm()
        self.b, _ = holland_b(self.storm)

    def test_center_and_far_pressure(self):
        self.assertEqual(pressure_hpa(self.storm, 0, self.b), self.storm.central_pressure_hpa)
        self.assertGreater(pressure_hpa(self.storm, 500, self.b), 1000)

    def test_peak_wind_at_radius_of_maximum(self):
        self.assertAlmostEqual(tangential_wind_ms(self.storm, 38, self.b) * 3.6,
                               self.storm.maximum_wind_kmh, delta=2)

    def test_northern_cyclonic_rotation(self):
        east, north = wind_vector_ms(self.storm, 38, 0, self.b)
        self.assertGreater(north, 0)
        self.assertLess(east, 0)

    def test_great_circle_motion(self):
        lat, lon = destination(0, 0, 90, 111.2)
        self.assertAlmostEqual(lat, 0, delta=0.01)
        self.assertAlmostEqual(lon, 1, delta=0.02)

    def test_no_dollar_loss_without_exposure(self):
        result = simulate(self.storm)
        self.assertIsNone(result["loss"]["estimated_loss_usd"])
        self.assertEqual(len(result["track"]), 25)

    def test_derived_profile_and_threshold_radii(self):
        result = simulate(self.storm)
        at_rmax = next(p for p in result["radial_profile"] if p["radius_km"] == 38)
        self.assertAlmostEqual(at_rmax["wind_energy_j_m3"],
                               0.5 * 1.15 * (at_rmax["wind_kmh"] / 3.6) ** 2, delta=0.1)
        self.assertGreater(at_rmax["pressure_gradient_pa_km"], 0)
        self.assertGreater(at_rmax["vorticity_1e5_s"], 0)
        self.assertGreater(result["wind_radii_km"]["34kt"], result["wind_radii_km"]["64kt"])

    def test_translation_creates_azimuthal_asymmetry(self):
        result = simulate(self.storm)
        winds = [p["wind_kmh"] for p in result["azimuthal_profile"]]
        self.assertGreater(max(winds) - min(winds), 5)

    def test_southern_hemisphere_vorticity_is_negative(self):
        south = Storm.from_dict({"latitude": -18})
        result = simulate(south)
        at_rmax = next(p for p in result["radial_profile"] if p["radius_km"] == 38)
        self.assertLess(at_rmax["vorticity_1e5_s"], 0)

    def test_invalid_nonfinite_input(self):
        with self.assertRaises(ValueError):
            Storm.from_dict({"maximum_wind_kmh": float("nan")})


if __name__ == "__main__":
    unittest.main()

