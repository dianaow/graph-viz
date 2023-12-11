import * as d3 from "d3";
import { bfsFromNode } from "graphology-traversal";
import { dijkstra } from "graphology-shortest-path";
import Graph from "graphology";

function generatePath(d, exclude_radius) {
  var dx = d.target.x - d.source.x;
  var dy = d.target.y - d.source.y;
  var gamma = Math.atan2(dy, dx); // Math.atan2 returns the angle in the correct quadrant as opposed to Math.atan

  if (exclude_radius) {
    var sourceNewX = d.source.x + Math.cos(gamma) * d.source.r;
    var sourceNewY = d.source.y + Math.sin(gamma) * d.source.r;
    var targetNewX = d.target.x - Math.cos(gamma) * d.target.r;
    var targetNewY = d.target.y - Math.sin(gamma) * d.target.r;
  } else {
    var sourceNewX = d.source.x;
    var sourceNewY = d.source.y;
    var targetNewX = d.target.x;
    var targetNewY = d.target.y;
  }

  // Coordinates of mid point on line to add new vertex.
  let midX = (targetNewX - sourceNewX) / 2 + sourceNewX;
  let midY = (targetNewY - sourceNewY) / 2 + sourceNewY;
  return "M" + sourceNewX + "," + sourceNewY + "L" + midX + "," + midY + "L" + targetNewX + "," + targetNewY;
}

// Throttle function to limit the mouseover event frequency
function throttle(func, delay) {
  let timeout;
  return function () {
    if (!timeout) {
      func.apply(this, arguments);
      timeout = setTimeout(() => {
        timeout = null;
      }, delay);
    }
  };
}

export default function ForceGraph(
  {
    nodes, // an iterable of node objects (typically [{id}, …])
    links, // an iterable of link objects (typically [{source, target}, …])
  },
  {
    containerSelector,
    nodeId = "id", // given d in nodes, returns a unique identifier (string)
    sourceId = "source",
    targetId = "target",
    nodeGroup, // given d in nodes, returns an (ordinal) value for color
    nodeGroups, // an array of ordinal values representing the node groups
    nodeTitle, // given d in nodes, a title string
    nodeFill = "currentColor", // node stroke fill (if not using a group color encoding)
    nodeStroke = "#ffffff", // node stroke color
    nodeStrokeWidth = 1, // node stroke width, in pixels
    nodeFillOpacity = 1, // node stroke opacity
    nodeStrokeOpacity = 1, // node stroke opacity
    linkStroke = "#000000", // link stroke color
    linkStrokeOpacity = 0.7, // link stroke opacity
    linkStrokeWidth = 1.5, // given d in links, returns a stroke width in pixels
    labelFontWeight = "normal",
    labelVisibility = "hidden",
    labelColor = "#000000",
    colors = d3.schemeTableau10, // an array of color strings, for the node groups
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    tooltipStyles = {
      width: "auto",
      height: "auto",
      padding: "10px",
      "background-color": "white",
      border: "1px solid black",
      "z-index": 10,
    },
  } = {}
) {
  // Initial states
  let showEle = {}
  let nodeDegrees = {}; // an object to store each node degree (number of connections that a node has to other nodes in the network)
  let singleNodeIDs = []; // an array to store the names of nodes with no connections to other nodes

  // Click helper states
  let clickedNodes = []; // an array to store the names of clicked nodes
  let clickCount = 0;
  let timer;

  // View states
  let searched = false; // if node is searched for from the searchbox or tree, searched=true
  let clickedSP = false; // if two nodes are clicked to reveal the shortest path (SP) results between them, clickedSP=true
  let clickedNN = false; // if a node has been clicked to reveal its nearest neighbor (NN), clickedNN=true

  // Button activation states
  // Note: there are different consequences for a VIEW state and BUTTON ACTIVATION state, so these variables are separated)
  let showArrows = false; // if edge directions are shown on graph, showArrows=true
  let showNeighbors = false; // if user is allowed to mouseover node to begin search for OUTWARD-BOUND ONLY neighbours 2 degrees away, showNeighours=true
  let showShortestPath = false; // if user is allowed to click on any node to begin SP search, showShortestPath = true (this flag helps to differentiate from click-to-drag event)
  let showSingleNodes = true; // to show/hide on screen nodes with no connections

  // Set up accessors to enable a cleaner way of accessing data attributes
  const N = d3.map(nodes, (d) => d[nodeId]).map(intern);
  const LS = d3.map(links, (d) => d[sourceId]).map(intern);
  const LT = d3.map(links, (d) => d[targetId]).map(intern);

  // Replace the input nodes and links with mutable objects for the simulation
  showEle.nodes = d3.map(nodes, (d, i) => ({ 
    id: N[i], 
    ...d 
  }));
  showEle.links = d3.map(links, (d, i) => ({
    source: LS[i],
    target: LT[i],
    ...d
  }));

  // To calculate number of incoming connections to size node radius
  showEle.nodes.forEach((node) => {
    nodeDegrees[node.id] = 0;
  });

  showEle.links.forEach((link) => {
    nodeDegrees[link.source]++;
    // Sizes of the nodes weighted by the number of links going to that node.
    nodeDegrees[link.target]++;
  });

  const nodeRadiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(Object.values(nodeDegrees))])
    .range([4.5, 22])
    .clamp(true);

  /////////////////// Set up initial  DOM elements on screen ///////////////////
  // Create a container for tooltip that is only visible on mouseover of a node
  const tooltip = d3.select("#app").append("div").attr("class", "tooltip").style("position", "absolute").style("visibility", "hidden");

  for (const prop in tooltipStyles) {
    tooltip.style(prop, tooltipStyles[prop]);
  }

  // Create a container to show / track clicked node selection to find shortest path
  const message = d3.select("#app").append("div").attr("class", "message");

  message.append("h2").attr("class", "clickedNodes-1");

  message.append("h2").attr("class", "clickedNodes-2");

  message.append("h3").attr("class", "shortestPath-status");

  message
    .append("h3")
    .attr("class", "clickedNodes-reset")
    .attr("text-decoration", "underline")
    .attr("pointer-events", "auto")
    .attr("cursor", "pointer")
    .style("color", "white")
    .html("RESET")
    .on("click", function () {
      reset();
    });

  // Create a container for the graph
  const svg = d3
    .select(containerSelector)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [-width / 2, -height / 2, width, height])
    .attr("style", "max-width: 100%; height: auto; pointer-events: auto;");

  // Create and store arrowheads that will be used when the lines are rendered later
  svg.append("defs").append("marker").attr("id", "arrowhead").attr("viewBox", "-0 -5 10 10").attr("refX", 0).attr("refY", 0).attr("orient", "auto").attr("markerWidth", 5).attr("markerHeight", 5).attr("xoverflow", "visible").append("svg:path").attr("d", "M 0,-5 L 10 ,0 L 0,5").attr("fill", linkStroke).style("stroke", "none");

  const g = svg.append("g");

  const linkG = g.append("g").attr("class", "links");
  
  const linkTextG = g.append("g").attr("class", "linkTexts");

  const nodeG = g.append("g").attr("class", "nodes");

  const textG = g.append("g").attr("class", "labels");

  //////////////////////////////////////////////////////////////////////////////

  /////////////////////////// add zoom capabilities ////////////////////////////
  const zoomHandler = d3.zoom().on("zoom", function (event) {
    g.attr("transform", event.transform);
    // if (clicked || searched) return;
    // zoomLevel = event.transform.k;
    // if (zoomLevel >= 3.5) {
    //   svg.selectAll(".label").attr("visibility", (d) => (d.linkCnt >= 10 ? "visible" : "hidden"));
    // } else if (zoomLevel >= 2) {
    //   svg.selectAll(".label").attr("visibility", (d) => (d.linkCnt >= 20 ? "visible" : "hidden"));
    // } else if (zoomLevel < 2) {
    //   svg.selectAll(".label").attr("visibility", labelVisibility);
    // }
  });

  svg.call(zoomHandler);
  //////////////////////////////////////////////////////////////////////////////
  const simulation = d3.forceSimulation();

  update();

  // Initialize a panel of buttons to configure initial graph state and handle future interaction with graph
  createButtons();

  // Initialize search box with searchable items (Note: Will have to think of how to update search results when user filters graph)
  createSearch(nodes);

  //////////////////////////////////////////////////////////////////////////////

  /////////////////////// SIMULATION-RELATED FUNCTIONS /////////////////////////
  function update() {
    // PRECAUTIONARY ACTION: REMOVE DUPLICATE LINKS
    const uniqueLinks = [];
    const uniqueLinksSet = new Set();
    showEle.links.forEach((link) => {
      if (Object.keys(link).length === 0) return;
      const sourceID = link.source.id ? link.source.id : link.source;
      const targetID = link.target.id ? link.target.id : link.target;
      const linkStr = `${sourceID}-${targetID}`;
      if (!uniqueLinksSet.has(linkStr)) {
        uniqueLinksSet.add(linkStr);
        uniqueLinks.push(link);
      }
    });
    showEle.links = uniqueLinks;
    console.log(showEle);

    // Set up accessors to enable a cleaner way of accessing attributes of each node and edge
    const T = nodeTitle === undefined ? d3.map(showEle.nodes, (d) => d.NAME).map(intern) : d3.map(showEle.nodes, nodeTitle).map(intern);
    const G = nodeGroup == null ? null : d3.map(showEle.nodes, nodeGroup).map(intern);
    const W = typeof linkStrokeWidth !== "function" ? null : d3.map(showEle.links, linkStrokeWidth);
    const L = typeof linkStroke !== "function" ? null : d3.map(showEle.links, linkStroke);
    if (G && nodeGroups === undefined) nodeGroups = d3.sort(G);
    const color = nodeGroup == null ? null : d3.scaleOrdinal(nodeGroups, colors);

    showEle.nodes.forEach((n) => {
      n.linkCnt = nodeDegrees[n.id] || 0;
    });

    const graph = initGraphologyGraph(showEle.nodes, showEle.links);

    const clickNodeForShortestPath = (dd) => {
      if (clickedNodes.length < 2) {
        if (clickedNodes.indexOf(dd.id) === -1) {
          // if the same node is not already clicked, add to array
          clickedNodes.push(dd.id);
        } else {
          clickedNodes.splice(dd.id, 1); // remove a clicked node if the same node is clicked again
        }
      }
      clickedNodesFeedback(clickedNodes); // render clicked node(s) name on screen to let the user know they have engaged with the circle
      // Only proceed with finding shortest path between 2 different clicked nodes
      if (clickedNodes.length === 2) {
        const connectedNodes = findShortestPath(graph, clickedNodes);
        clickedSP = true; // Flag to prevent any action that should not happen during shortest path view
        if (connectedNodes) {
          console.log("highlight connections");
          // Only proceed with showing the nodes and paths that constitute the shortest path if it exist
          highlightConnections(connectedNodes);
        } else {
          // Provide feedback to user that no shortest path exist between the 2 nodes
          d3.select(".shortestPath-status").html("No shortest path found. Would you like to try again?");
        }
        // disable tree interaction to prevent interference with current shortest path view
        document.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => (checkbox.disabled = true));
      }
    };

    const clickNodeForNearestNeighbor = (dd) => {
      updateTooltip(dd); // show tooltip on mouseover any node

      const connectedNodes = findNeighbours(graph, [dd]);
      if (connectedNodes) highlightConnections(connectedNodes);
      message.style("visibility", "visible"); // Show RESET message
      clickedNN = true;
    };

    ////////////////////////// Run simulation on data ///////////////////////////
    simulation
      .force(
        "link",
        d3.forceLink().id((d) => d.id).distance(100)
      )
      .force(
        "x",
        d3.forceX((d) => d.x)
      )
      .force(
        "y",
        d3.forceY((d) => d.y)
      )
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d) => d.radius)
          .iterations(3)
      )
      //.force("charge", d3.forceManyBody().strength(Math.max(-200, -10000 / showEle.nodes.length)))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("cluster", forceCluster().strength(0.15));

    // Restart the force layout
    simulation.nodes(showEle.nodes).force("link").links(showEle.links);

    simulation.on("tick", ticked);

    simulation
      .alphaTarget(0.5)
      .alphaDecay(0.3)
      .restart(); // increase alphaDecay value to cool down a graph more quickly

    // Update existing links
    const link = linkG
      .selectAll("path.link")
      .data(showEle.links)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "link")
            .attr("id", (d) => d.source.id + "_" + d.target.id),

        (update) => update,
        (exit) => exit.remove()
      )
      .attr("stroke", linkStroke)
      .attr("stroke-width", linkStrokeWidth)
      .attr("opacity", (d) => (showEle.links.length > 200 ? 0.25 : linkStrokeOpacity))
      .attr("d", (d) => generatePath(d));

    if (showArrows) {
      linkG.selectAll("path.link").attr("marker-mid", "url(#arrowhead)"); // render arrow heads in the middle of line
    }

    if (W) link.attr("stroke-width", (d, i) => W[i]);
    if (L) link.attr("stroke", (d, i) => L[i]);

    // Update existing links
    const linkTexts = linkTextG
    .selectAll("text.link")
    .data(showEle.links)
    .join(
      (enter) =>
        enter
          .append("text")
          .attr("class", "link")
          .attr("x", d => (d.target.x - d.source.x) / 2 + d.source.x + 10)
          .attr("y", d => (d.target.y - d.source.y) / 2 + d.source.y)
          .text((d) => d.Relation),

      (update) => update,
      (exit) => exit.remove()
    )
    .attr("opacity", 0.2)
    .attr("fill", linkStroke)
    .attr('font-size', '6px')

    // Update existing nodes
    const updatedNode = nodeG.selectAll(".node").data(showEle.nodes, (d) => d.id);

    updatedNode.join(
      (enter) => {
        const newNode = enter
          .append("g")
          .attr("class", "node")
          .attr("pointer-events", "auto")
          .attr("cursor", "pointer")
          .attr("opacity", 1)
          .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
          .call(drag(simulation))
          .on("click", function (event, dd) {
            event.preventDefault();
            if (searched) return;
            clickCount++;
            if (clickCount === 1) {
              // Different types of click actions based on button activated
              if (showShortestPath) {
                timer = setTimeout(function () {
                  clickNodeForShortestPath(dd);
                  clickCount = 0;
                }, 300);
              } else if (showNeighbors) {
                timer = setTimeout(function () {
                  clickNodeForNearestNeighbor(dd);
                  clickCount = 0;
                }, 300);
              } else {
                // reset the clickCount if the time between first and second click exceeds 300ms.
                timer = setTimeout(function () {
                  clickCount = 0;
                }, 300);
              }
              // disable expand/collapse feature if either nearest neighbour or shortest path button is activated
            } else if (clickCount === 2 && !showShortestPath && !showNeighbors) {
              clearTimeout(timer);
              dblclickNode(node);
              clickCount = 0;
            }
          })
          .on("dblclick.zoom", null)
          .on("mouseover", function (event, dd) {
            updateTooltip(dd); // show tooltip on mouseover any node
          })
          .on("mouseleave", function () {
            tooltip.style("visibility", "hidden");
          })

        newNode
          .append("circle")
          .attr("fill", nodeFill)
          .attr("stroke", nodeStroke)
          .attr("r", (d) => nodeRadiusScale(d.linkCnt))
          .attr("fill-opacity", nodeFillOpacity)
          .attr("stroke-opacity", nodeStrokeOpacity)
          .attr("stroke-width", nodeStrokeWidth);

        if (G) newNode.select("circle").attr("fill", (d, i) => color(G[i]));

        return newNode;
      },
      (update) => update,
      (exit) => exit.remove()
    );

    // Update existing text elements
    const updatedText = textG.selectAll(".label").data(showEle.nodes, (d) => d.id);

    updatedText.join(
      (enter) => {
        const newText = enter
          .append("g")
          .attr("class", "label")
          .attr("opacity", 1)
          .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
          .attr("visibility", labelVisibility);

        newText
          .append("text")
          .attr("x", (d) => nodeRadiusScale(d.linkCnt) + 2) // position label next to node without overlap
          .attr("dominant-baseline", "middle")
          .attr("text-anchor", "start")
          .attr("fill", labelColor)
          .attr("stroke", "black")
          .attr("stroke-width", 0.25)
          .attr("font-size", (d) => Math.max(8, nodeRadiusScale(d.linkCnt))) // label size is proportionate to node size
          .attr("font-weight", labelFontWeight)
          .text((d, i) => T[i]);

        return newText;
      },
      (update) => update,
      (exit) => exit.remove()
    );

    function ticked() {
      link.attr("d", (d) => generatePath(d));
      nodeG.selectAll(".node").attr("transform", (d) => `translate(${d.x}, ${d.y})`);
      textG.selectAll(".label").attr("transform", (d) => `translate(${d.x}, ${d.y})`);
      linkTexts
        .attr("x", d => (d.target.x - d.source.x) / 2 + d.source.x  + 6)
        .attr("y", d => (d.target.y - d.source.y) / 2 + d.source.y)
    }
  }

  function drag(simulation) {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
  }

  function centroid(nodes) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const d of nodes) {
      let k = nodeRadiusScale(d.linkCnt) ** 2;
      x += d.x * k;
      y += d.y * k;
      z += k;
    }
    return { x: x / z, y: y / z };
  }

  function forceCluster() {
    var strength = 0.8;
    let nodes;
    function force(alpha) {
      const centroids = d3.rollup(nodes, centroid, nodeGroup);
      const l = alpha * strength;
      for (const d of nodes) {
        const { x: cx, y: cy } = centroids.get(d.CATEGORY);
        d.vx -= (d.x - cx) * l;
        d.vy -= (d.y - cy) * l;
      }
    }
    force.initialize = (_) => (nodes = _);
    force.strength = function (_) {
      return arguments.length ? ((strength = +_), force) : strength;
    };
    return force;
  }
  //////////////////////////////////////////////////////////////////////////////

  /////////////////////// INTERACTION-RELATED FUNCTIONS ////////////////////////
  function highlightNode(dd) {
    nodeG.selectAll(".node").attr("opacity", (d) => (d.id == dd ? 1 : 0.2));
    linkG.selectAll("path.link").attr("opacity", 0.1);
    linkTextG.selectAll("text.link").attr("opacity", 0.1);
    textG.selectAll(".label").attr("visibility", (d) => (d.id == dd ? "visible" : "hidden"));
  }

  function highlightConnections(connectedNodes) {
    nodeG.selectAll(".node").attr("opacity", (d) => (connectedNodes.indexOf(d.id) !== -1 ? 1 : 0));
    linkG.selectAll("path.link").attr("opacity", (d) => (connectedNodes.indexOf(d.source.id) !== -1 && connectedNodes.indexOf(d.target.id) !== -1 ? 1 : 0));
    linkTextG.selectAll("text.link").attr("opacity", (d) => (connectedNodes.indexOf(d.source.id) !== -1 && connectedNodes.indexOf(d.target.id) !== -1 ? 1 : 0));
    textG.selectAll(".label").attr("visibility", (d) => (connectedNodes.indexOf(d.id) !== -1 ? "visible" : "hidden"));
  }
  
  // Un-highlight all elements and hide tooltip
  function reset() {
    nodeG.selectAll(".node").attr("opacity", 1);
    nodeG.selectAll(".node").selectAll("circle").attr("stroke", nodeStroke).attr("stroke-width", nodeStrokeWidth);
    linkG.selectAll("path.link").attr("opacity", (d) => (showEle.links.length > 200 ? 0.25 : linkStrokeOpacity));
    linkTextG.selectAll("text.link").attr("opacity", 0.2);
    textG.selectAll(".label").attr("visibility", labelVisibility);
    
    tooltip.style("visibility", "hidden");

    if (searched) {
      svg.transition().duration(500).call(zoomHandler.transform, d3.zoomIdentity);
      searched = false;
      document.getElementById("search-input").value = "";
      document.getElementById("suggestions-container").innerHTML = "";
      document.getElementById("reset-search").style.display = "none";
      message.select(".shortestPath-status").html("");
    }

    // Undo clicked states
    clickedNN = false;
    clickedSP = false;
    clickedNodes = [];
    message.select(".clickedNodes-1").html("");
    message.select(".clickedNodes-2").html("");
    message.select(".shortestPath-status").html("");
    message.style("visibility", "hidden");

    tooltip.style("visibility", "hidden");
  }

  function clickedNodesFeedback(clickedNodes) {
    // Track which nodes have been clicked and render their names on screen
    if (clickedNodes[0]) d3.select(".clickedNodes-1").html("Start node: " + clickedNodes[0]);
  
    if (clickedNodes[1]) d3.select(".clickedNodes-2").html("End node: " + clickedNodes[1]);
  
    if (clickedNodes.length > 0) {
      d3.select(".message").style("visibility", "visible");
    }
  }
  
  function findShortestPath(graph, clickedNodes) {
    // OUTWARD-BOUND only, meaning the first clickedNode has to be the source node of the path
    const connectedNodes = dijkstra.bidirectional(graph, clickedNodes[0], clickedNodes[1]);
    if (connectedNodes) {
      // Only proceed with showing the nodes and paths that constitute the shortest path if it exist
      highlightConnections(connectedNodes);
    } else {
      // Provide feedback to user that no shortest path exist between the 2 nodes
      d3.select(".shortestPath-status").html("No shortest path found. Would you like to try again?");
    }
  }
  
  // Find neighboring connections of the clicked node (up to 2 degrees away, OUTWARD-BOUND only: meaning target nodes their links)
  function findNeighbours(graph, dd_arr) {
    let connectedNodes = [];
    dd_arr.forEach((dd) => {
      bfsFromNode(graph, dd.id ? dd.id : dd, function (node, attr, depth) {
        if (depth <= 2) {
          connectedNodes.push(node);
        }
      });
    });
    highlightConnections(connectedNodes);
  }

  function updateTooltip(d) {
    let content = [];
    content.push(`<div><h3>${d.id}</h3></div>`); // tooltip title
    for (const [key, value] of Object.entries(d)) {
      // iterate over each attribute object and render
      if (key === "fx" || key === "fy" || key === "vx" || key === "vy" || key === "x" || key === "y" || key === "index" || key === "id") continue;
      content.push(`<div><b>${key}: </b><span>${value}</span></div>`);
    }
    let contentStr = "";
    content.map((d) => (contentStr += d));

    tooltip
      .html(`${contentStr}`)
      //.style('top', event.y - 300+ 'px')
      //.style('left', event.x - 100 + 'px')
      .style("top", 95 + "px") // adjust starting point of tooltip div to minimise chance of overlap with node
      .style("left", 5 + "px")
      .style("visibility", "visible");
  }

  // Function to zoom to a specific node
  function zoomToNode(node) {
    // Calculate the new zoom transform
    const scale = 2; // You can adjust the zoom level as needed
    const x = -node.x * scale;
    const y = -node.y * scale;
    const transform = d3.zoomIdentity.translate(x, y).scale(scale);
    // Apply the new zoom transform with smooth transition
    svg.transition().duration(500).call(zoomHandler.transform, transform);
  }
  //////////////////////////////////////////////////////////////////////////////

  /////////////////////// HELPER FUNCTIONS ////////////////////////
  function intern(value) {
    return value !== null && typeof value === "object" ? value.valueOf() : value;
  }

  function createButtons() {
    // Function to create a button element with a specified label and action
    function createButton(label, action) {
      const button = document.createElement("button");
      button.textContent = label;
      button.classList.add("button");
      button.addEventListener("click", action);
      return button;
    }

    // Function to perform an action when a button is clicked
    function buttonClickHandler(event) {
      const buttonId = event.target.getAttribute("data-button-id");

      // Check which button was clicked using its ID
      switch (buttonId) {
        case "button1": // SHOW DIRECTION
          showArrows = !showArrows;
          if (showArrows) {
            event.target.classList.add("clicked");
            linkG.selectAll("path.link").attr("marker-mid", "url(#arrowhead)");
          } else {
            event.target.classList.remove("clicked");
            linkG.selectAll("path.link").attr("marker-mid", null);
          }
          break;
        case "button2": // SHOW NEAREST NEIGHBOUR
          if (clickedSP || searched) return; // disable action if screen is at shortest path view / searched node view
          showNeighbors = !showNeighbors;
          if (showNeighbors) {
            event.target.classList.add("clicked");
          } else {
            event.target.classList.remove("clicked");
            reset();
          }
          showShortestPath = false;
          document.querySelector('.button[data-button-id="button3"]').classList.remove("clicked");
          break;
        case "button3": // SHOW SHORTEST PATH
          if (searched) return; // disable action if screen is at searched node view
          showShortestPath = !showShortestPath;
          if (showShortestPath) {
            event.target.classList.add("clicked");
          } else {
            event.target.classList.remove("clicked");
            reset();
          }
          showNeighbors = false;
          clickedNN = false;
          document.querySelector('.button[data-button-id="button2"]').classList.remove("clicked");
          break;
        case "button4":
          if (clickedSP || searched || clickedNN) return; // disable action if screen is at shortest path view / searched node view  / nearest neighbor view
          // Note: If a single node is still shown on screen despite clicking the button, it's because some nodes have links where the source and target is the node itself.
          showSingleNodes = !showSingleNodes;
          if (showSingleNodes) {
            event.target.classList.add("clicked");
            // Find nodes without any connections
            const graph = initGraphologyGraph(showEle.nodes, showEle.links);
            singleNodeIDs = showEle.nodes.filter((n) => graph.degreeWithoutSelfLoops(n.id) === 0).map((d) => d.id);
            // Hide the opacity of these single nodes
            nodeG
              .selectAll(".node")
              .filter((d) => singleNodeIDs.indexOf(d.id) !== -1)
              .attr("opacity", 0);
            textG
              .selectAll(".label")
              .filter((d) => singleNodeIDs.indexOf(d.id) !== -1)
              .attr("visibility", "hidden");
          } else {
            event.target.classList.remove("clicked");
            nodeG.selectAll(".node").attr("opacity", 1);
            textG.selectAll(".label").attr("visibility", labelVisibility);
          }
          break;
        case "button5":
          reset();
          // Unhighlight all buttons
          const buttons = document.querySelectorAll("button");
          buttons.forEach(function (item, index) {
            item.classList.remove("clicked");
          });
          clickedNodes = [];
          clickedSP = false;
          clickedNN = false;
          showArrows = false;
          showNeighbors = false;
          showShortestPath = false;
          searched = false;
          showSingleNodes = true;
          break;
        default:
          // Handle cases where an unknown button was clicked
          break;
      }
    }

    // Create an array of button labels
    const buttonLabels = ["Show directions", "Show neighbors",  "Show shortest path", "Hide Single Nodes", "Reset"];

    // Get the button panel element
    const buttonPanel = document.getElementById("buttonPanel");

    // Create and append buttons to the panel
    buttonLabels.forEach((label, index) => {
      const button = createButton(label, buttonClickHandler);
      button.setAttribute("data-button-id", `button${index + 1}`);
      buttonPanel.appendChild(button);
    });
  }

  function createSearch(variableData) {
    const searchInput = document.getElementById("search-input");
    const resetSearchIcon = document.getElementById("reset-search");
    const suggestionsContainer = document.getElementById("suggestions-container");

    // Function to filter suggestions based on user input
    function filterSuggestions(input) {
      return variableData.filter((item) => {
        return item.NAME.toLowerCase().includes(input.toLowerCase());
      });
    }

    // Function to update the suggestions dropdown
    function updateSuggestions(input) {
      const filteredSuggestions = filterSuggestions(input);
      suggestionsContainer.innerHTML = "";

      filteredSuggestions.sort(function (a, b) {
        return a.NAME.toLowerCase().localeCompare(b.NAME.toLowerCase());
      });

      filteredSuggestions.forEach((item) => {
        const suggestionElement = document.createElement("div");
        suggestionElement.classList.add("suggestion");
        suggestionElement.textContent = `${item.NAME}`;
        suggestionElement.addEventListener("click", () => {
          searched = true;
          searchInput.value = item.NAME;
          suggestionsContainer.style.display = "none";
          resetSearchIcon.style.display = "block";

          const node = showEle.nodes.find((n) => n.NAME === item.NAME);
          if (node) {
            zoomToNode(item.NAME);
            highlightNode(item.NAME);
          } else {
            d3.select(".message").style("visibility", "visible");
            d3.select(".shortestPath-status").html("No such node found.");
          }
        });

        suggestionsContainer.appendChild(suggestionElement);
      });

      if (filteredSuggestions.length > 0) {
        suggestionsContainer.style.display = "block";
      } else {
        suggestionsContainer.style.display = "none";
      }
    }

    // Event listener for input changes
    searchInput.addEventListener("input", () => {
      simulation.alpha(0);
      const inputValue = searchInput.value;
      updateSuggestions(inputValue);
    });

    // Event listener for clicking the reset icon
    resetSearchIcon.addEventListener("click", () => {
      searched = false;
      searchInput.value = "";
      suggestionsContainer.innerHTML = "";
      resetSearchIcon.style.display = "none";
      reset();
    });

    // Close suggestions when clicking outside
    document.addEventListener("click", (event) => {
      if (!suggestionsContainer.contains(event.target)) {
        suggestionsContainer.style.display = "none";
      }
    });
  }
  //////////////////////////////////////////////////////////////////
}

function initGraphologyGraph(nodes, links) {
  // Initialize a new Graphology graph and add all nodes and edges to it
  // This will be used for shortest path and finding neighbours later
  const graph = new Graph();

  nodes.forEach((n) => {
    if (!graph.hasNode(n.id)) graph.addNode(n.id);
  });
  links.forEach((e) => {
    if (e.source.id && e.target.id) {
      if (graph.hasNode(e.source.id) && graph.hasNode(e.target.id)) {
        if (!graph.hasEdge(e.source.id, e.target.id)) {
          graph.addEdge(e.source.id, e.target.id);
        }
      }
    } else {
      if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
        if (!graph.hasEdge(e.source, e.target)) {
          graph.addEdge(e.source, e.target);
        }
      }
    }
  });

  return graph;
}