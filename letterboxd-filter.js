const parser = new DOMParser();

async function run() {
  const startingYear = parseInt(document.getElementById("startingYear").value);
  const endingYear = parseInt(document.getElementById("endingYear").value);

  const yearNumbers = Array.from(
    { length: endingYear - startingYear + 1 },
    (_, i) => {
      return startingYear + i;
    }
  );

  const runButton = document.getElementById("runButton");
  const runButtonParent = runButton.parentElement;
  runButtonParent.removeChild(runButton);

  const progressText = document.getElementById("progressText");
  progressText.innerText = "Script running, please wait...";

  let allRankings = [];

  for (const year of yearNumbers) {
    progressText.innerText = `Fetching rankings for year ${year}...`;

    const rankings = await fetchYearRankings(year);
    allRankings.push(rankings);
  }

  const sortingOption = document.getElementById("sortingOption").value;
  const sortedMovieList = sortMovieList(
    allRankings.flatMap((year) => year.rankings),
    sortingOption
  );

  console.log({ allRankings });
  console.log({ movieList: sortedMovieList });
  console.log(
    "Copy the movieList object value above and parse it to a CSV in https://www.convertcsv.com/json-to-csv.htm, and then go to the Letterboxd list and import the CSV there"
  );

  progressText.innerText =
    "Rankings fetched successfully! Open the console to see the logs.";
}

async function fetchYearRankings(year) {
  const numberOfMoviesPerYear = parseInt(
    document.getElementById("numberOfMoviesPerYear").value
  );

  const minViewsBefore1946 = parseInt(
    document.getElementById("minViewsBefore1946").value
  );

  const minViewsAfter1945 = parseInt(
    document.getElementById("minViewsAfter1945").value
  );

  let minimumViews;

  if (year <= 1945) {
    minimumViews = minViewsBefore1946;
  } else {
    minimumViews = minViewsAfter1945;
  }

  const specificYearRankingsValid = [];
  const specificYearRankingsInvalid = [];
  let currentPage = 1;

  while (true) {
    const yearUrl = `https://letterboxd.com/films/ajax/popular/year/${year}/page/${currentPage}/?esiAllowFilters=true`;
    const yearUrlResponse = await fetch(yearUrl);
    const yearUrlHtml = await yearUrlResponse.text();
    const yearUrlDoc = parser.parseFromString(yearUrlHtml, "text/html");

    const elements = [...yearUrlDoc.querySelectorAll(".film-poster")];

    if (!elements.length) {
      break;
    }

    const fetchPromises = elements.map((element) =>
      fetchMovieInfoWithRetry(element, year).catch((error) => {
        console.error(
          `Error fetching movie info for ${element.getAttribute(
            "data-film-slug"
          )}:`,
          error
        );
        return null;
      })
    );

    const results = await Promise.all(fetchPromises);
    for (const movieTotalViews of results) {
      if (movieTotalViews === null) {
        // Skip movies with errors
        continue;
      }

      if (movieTotalViews.watches >= minimumViews) {
        specificYearRankingsValid.push(movieTotalViews);
      } else {
        specificYearRankingsInvalid.push(movieTotalViews);
      }
    }

    if (specificYearRankingsInvalid.length > 15) {
      break;
    }

    currentPage++;
  }

  const sortingOption = document.getElementById("sortingOption").value;
  const ignoreDocumentaries = document.getElementById(
    "ignoreDocumentaries"
  ).checked;

  const filteredRankings = specificYearRankingsValid.filter((movie) => {
    const uppercaseGenres = movie.genres.map((g) => g.toUpperCase());
    const isDocumentary = uppercaseGenres.includes("DOCUMENTARY");

    if (ignoreDocumentaries && isDocumentary) {
      return false;
    }

    return true;
  });

  const sortedMovies = sortMovieList(filteredRankings, sortingOption);

  return {
    year,
    rankings: sortedMovies.slice(0, numberOfMoviesPerYear)
  };
}

async function fetchMovieInfoWithRetry(
  element,
  year,
  maxRetries = 5,
  retryDelay = 3000
) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const movieInfo = await fetchMovieInfo(element, year);
      return movieInfo;
    } catch (error) {
      console.error(`Error fetching movie info (retry ${retries + 1}):`, error);
      retries++;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(`Failed to fetch movie info after ${maxRetries} retries`);
}

async function fetchMovieInfo(element, year) {
  const filmSlug = element.getAttribute("data-film-slug");

  const userBlacklist = document
    .getElementById("userBlacklist")
    .value.split(", ")
    .map((slug) => slug.trim());

  if (userBlacklist.includes(filmSlug)) {
    console.log(`Skipping movie: ${filmSlug} (in blacklist)`);
    return null;
  }

  let LetterboxdURI = `https://letterboxd.com/film/${filmSlug}`;
  const id = element.getAttribute("data-film-id");
  const Title = element.querySelector("[alt]").getAttribute("alt");
  let imdbID = "";
  let tmdbID = "";

  const movieResponse = await fetch(LetterboxdURI);
  const movieHtml = await movieResponse.text();
  const movieDoc = parser.parseFromString(movieHtml, "text/html");

  let rating = 0;
  try {
    rating = parseFloat(
      movieDoc
        .querySelector('meta[name="twitter:data2"]')
        .getAttribute("content")
        .match(/\d+\.\d+/)[0]
    );
  } catch {}

  let genres = [];
  try {
    genres = Array.from(
      movieDoc.querySelectorAll("#tab-genres .text-sluglist a.text-slug")
    ).map((link) => link.textContent.trim());
  } catch {}

  const footerTags = movieDoc
    .querySelector(".text-footer")
    .querySelectorAll("a");

  imdbID = footerTags[0]
    .getAttribute("href")
    .replace("http://www.imdb.com/title/", "")
    .replace("/maindetails", "");
  tmdbID = footerTags[1]
    .getAttribute("href")
    .replace("https://www.themoviedb.org/movie/", "")
    .replace("/", "");

  let runTime = undefined;
  const runtimeRegex = /var filmData = {[^}]+runTime: (\d+)/;
  const match = movieHtml.match(runtimeRegex);

  if (match && match[1]) {
    runTime = parseInt(match[1]);
  }

  const statsResponse = await fetch(
    `https://letterboxd.com/esi/film/${element.getAttribute(
      "data-film-slug"
    )}/stats`
  );
  const statsHtml = await statsResponse.text();
  const statsDoc = parser.parseFromString(statsHtml, "text/html");

  let title = statsDoc.querySelector(".filmstat-watches [title]").title;
  const watches = parseInt(title.match(/[\d,]+/)[0].replace(/,/g, ""));

  title = statsDoc.querySelector(".filmstat-likes [title]").title;
  const likes = parseInt(title.match(/[\d,]+/)[0].replace(/,/g, ""));

  const fansResponse = await fetch(
    `https://letterboxd.com/film/${element.getAttribute(
      "data-film-slug"
    )}/fans/`
  );
  const fansHtml = await fansResponse.text();
  const fansDoc = parser.parseFromString(fansHtml, "text/html");
  let fansCount = 0;
  try {
    fansCount = parseInt(
      fansDoc
        .querySelector(".js-route-fans a.tooltip")
        .getAttribute("title")
        .match(/(\d|,)+/)[0]
        .replace(/,/g, "")
    );
  } catch {}

  let percentageFansFromWatches = 0;
  if (watches) percentageFansFromWatches = fansCount / watches;

  return {
    LetterboxdURI,
    Title,
    id,
    year,
    imdbID,
    tmdbID,
    rating,
    watches,
    likes,
    fansCount,
    percentageFansFromWatches,
    runTime,
    genres
  };
}

function sortMovieList(movieList, sortingOption) {
  const sortingFunctions = {
    rating: (a, b) => b.rating - a.rating,
    views: (a, b) => b.watches - a.watches,
    fans: (a, b) => b.fansCount - a.fansCount,
    fansRatio: (a, b) =>
      b.percentageFansFromWatches - a.percentageFansFromWatches
  };

  return movieList.sort(
    sortingFunctions[sortingOption] || sortingFunctions.rating
  );
}
