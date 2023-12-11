import ForceGraph from "./graph.js";

async function getData() {
  try {

    const params = {
      method: "GET",
      mode: "cors",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    };
    
    const [response1, response2] = await Promise.all([
      fetch("/api/UNDP-Data/dsc-energy-knowledge-graph/main/02_Output/01_Merged/Entities/energy-entities.json", params), 
      fetch("/api/UNDP-Data/dsc-energy-knowledge-graph/main/02_Output/01_Merged/Relations/energy-relations.json", params)
    ]);

    if (!response1.ok || !response2.ok) {
      throw new Error(`HTTP error! Status: ${response1.status} ${response2.status}`);
    }

    const resultNodes = await response1.json();
    const resultEdges = await response2.json();

    if (resultNodes && resultEdges) {
      const colors = ["#418BFC", "#46BCC8", "#D6AB1B", "#EB5E68", "#B6BE1C", "#F64D1A", "#BA6DE4", "#EA6BCB", "#B9AAC8", "#F08519"];
      const resultNodesTrunc = resultNodes.map((d) => {
        return {
          NAME: d.entity,
          CATEGORY: d.category
        };
      });

      // Execute the function to generate a new network
      ForceGraph(
        { nodes: resultNodesTrunc, links: resultEdges },
        {
          containerSelector: "#app",
          nodeId: "NAME",
          sourceId: "Subject",
          targetId: "Object",
          nodeGroup: (d) => d.CATEGORY,
          nodeTitle: (d) => d.NAME,
          linkStroke: "#fff",
          nodeStroke: "#000",
          linkStrokeWidth: 1,
          linkStroke: "#fff",
          labelColor: "#fff",
          colors,
          width: window.innerWidth,
          height: window.innerHeight,
          labelVisibility: 'visible',
          linkStrokeOpacity: 1
        }
      );
    } else {
      throw new Error("Invalid response format");
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

getData();
