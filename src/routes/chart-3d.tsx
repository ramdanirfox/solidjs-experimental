import "./index.css";
import "./../shared/styles/patch-deckgl.css"
import SJX3dchart from "~/components/SJX3dchart";

export default function PageSolidMaplibreGoogleMaps() {

  return (
    <main>
      <h1>Example 3D Chart</h1>
      <SJX3dchart
      title="Coba 3D"
        config={
          {
            "data": [
              {
                "cat_1": 70,
                "cat_2": 110,
                "cat_3": 145,
                "cat_4": 170,
                "cat_5": 230,
                "key": "2025-10-20"
              },
              {
                "cat_1": 30,
                "cat_2": 70,
                "cat_3": 100,
                "cat_4": 160,
                "cat_5": 200,
                "key": "2025-10-21"
              },
              {
                "cat_1": 40,
                "cat_2": 55,
                "cat_3": 110,
                "cat_4": 200,
                "cat_5": 235,
                "key": "2025-10-22"
              },
              {
                "cat_1": 30,
                "cat_2": 70,
                "cat_3": 160,
                "cat_4": 190,
                "cat_5": 242,
                "key": "2025-10-23"
              },
              {
                "cat_1": 20,
                "cat_2": 65,
                "cat_3": 118,
                "cat_4": 140,
                "cat_5": 190,
                "key": "2025-10-24"
              },
              {
                "cat_1": 50,
                "cat_2": 150,
                "cat_3": 175,
                "cat_4": 185,
                "cat_5": 290,
                "key": "2025-10-25"
              },
              {
                "cat_1": 40,
                "cat_2": 63,
                "cat_3": 135,
                "cat_4": 195,
                "cat_5": 260,
                "key": "2025-10-26"
              }
            ],
            "ref": {
              "cat_1": "Routing Issue",
              "cat_2": "Config Issue",
              "cat_3": "Latency Issue",
              "cat_4": "Capacity Issue",
              "cat_5": "Connectivity Issue"
            },
            "ref_color": {
              "cat_1": "#7086FD",
              "cat_2": "#6FD195",
              "cat_3": "#FFAE4C",
              "cat_4": "#FC30A4",
              "cat_5": "#07DBFA"
            },
            "total": {
              "cat_1": 280,
              "cat_2": 583,
              "cat_3": 943,
              "cat_4": 1240,
              "cat_5": 1647
            }
          }
        }></SJX3dchart>
    </main>
  );
}
