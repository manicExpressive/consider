#! /usr/bin/env node

import { writeFileSync } from "fs"; 
import { select, Separator } from "@inquirer/prompts";
import { argv } from "node:process";
import urlMetadata from "url-metadata";
import { program } from "commander";
import slugify from "slugify";
import "dotenv/config";

import TVDB from "node-tvdb";

import igdb from "igdb-api-node";

// This also provides a nice starter help output
program
  .option("-m, --music", "search query, results are albums")
  .option("-g, --game", "game query")
  .option("-t, --tv", "tv show")
  .option("-f, --film", "movie, but because m is for music, films")
  .option("-i, --iTVDB", "iTVDB")
  .argument("<searchQuery>", "A url or search query (you need http/s)");

program.parse(process.argv);

const options = program.opts();
const [searchQuery] = program.processedArgs;

// TODO: Don't love how hacky this is
const getAppleData = async function (query, entity) {
  let selectOptions = [];

  let iTunesResponse = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&country=us&limit=25&entity=${entity}`,
  ).then((res) => res.json());

  if (options.music || options.tv) {
    // easy special case for music, added TV because they both use collectionName the same way
    selectOptions = iTunesResponse.results.map((v) => ({
      value: v.collectionId,
      name: `${v.collectionName} by ${v.artistName} ${v.releaseDate.substring(0, 10)}`,
      fileName: slugify(
        `${v.collectionName} by ${v.artistName} ${v.releaseDate.substring(0, 10)}`,
      ),
      image: `${v.artworkUrl100.replace("100x100bb", "1000x1000bb")}`,
      artist: v.artistName,
      album: v.collectionName,
      releaseDate: `${v.releaseDate.substring(0, 10)}`,
    }));
    selectOptions.sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
  }

  if (options.film) {
    selectOptions = iTunesResponse.results.map((v) => ({
      value: v.collectionId,
      name: `${v.trackName} // ${v.releaseDate.substring(0, 10)}`,
      fileName: slugify(`${v.trackName} // ${v.releaseDate.substring(0, 10)}`),
      image: `${v.artworkUrl100.replace("100x100bb", "1000x1000bb")}`,
      director: v.artistName,
      album: v.collectionName,
      releaseDate: `${v.releaseDate.substring(0, 10)}`,
    }));
  }

  if (selectOptions.length < 1) {
    console.log("we need to stop here because we have no results");
  } else {
    const selectAnswer = await select({
      message: `Here's the iTunes store reults for ${searchQuery} in ${entity}`,
      choices: selectOptions,
      loop: false,
    });
    //TODO: I feel like there's a better way to do this
    let selection = selectOptions.find((album) => album.value == selectAnswer);
    return selection;
  }
};

const writeJson = function (frontMatter) {
  if (frontMatter) {
    console.log("Great news, we're writing this to a JSON file:");
    frontMatter.date_posted = Date.now();
    writeFileSync(
      `${frontMatter.fileName}.json`,
      JSON.stringify(frontMatter, null, 2),
    );
  }
};

try {
  let linkUrl = new URL(searchQuery);
  let metadata = await urlMetadata(linkUrl);
  metadata.fileName = slugify(metadata["title"]);

  writeJson(metadata);
} catch {
  const query = `${searchQuery}`;
  // TODO: Figure out what the default query style should be -
  // could be a setting or could be opinionated

  if (options.iTVDB) {
    console.log("got here");

    const tvdb = new TVDB(process.env.TVDBAPIKEY);

    let thisShow = tvdb
      .getSeriesByName("The Simpsons")

    console.log(await thisShow);
  }
  if (options.music) {
    writeJson(await getAppleData(query, "album"));
  }
  if (options.film) {
    writeJson(await getAppleData(query, "movie"));
  }
  if (options.tv) {
    writeJson(await getAppleData(query, "tvSeason"));
  }
  if (options.game) {
    let selectOptions = [];
    console.log("gonna hit the gmaes api:");

    const response = await igdb
      .default(process.env.IGDBCLIENTID, process.env.IGDBSECRET)
      .search(query) // search for a specific name (search implementations can vary)
      .fields("name,cover,cover.url,cover.image_id,id,first_release_date")
      // A reminder, read the docs before trying to guess the syntax
      // https://api-docs.igdb.com/#filters
      .where("cover != null")
      .request("/games");

    selectOptions = await response.data.map((v) => ({
      value: v.id,
      name: `${v.name} // ${new Date(v.first_release_date * 1000).toDateString()}`,
      realName: `${v.name}`,
      fileName: slugify(v.name),
      cover: v.cover,
      image: `https:${v.cover.url.replace("t_thumb", "t_cover_big_2x")}`,
      releaseDate: `${new Date(v.first_release_date * 1000)}`,
      date: v.first_release_date,
    }));

    // sort by recency makes sense for games and music but not for movies, right?
    selectOptions.sort((a, b) => (a.date < b.date ? 1 : -1));

    if (selectOptions.length < 1) {
      console.log("empty");
    } else {
      const selectAnswer = await select({
        message: `Here's the IGDB reults for ${searchQuery}`,
        choices: selectOptions,
        loop: false,
      });
      //TODO: I feel like there's a better way to do this
      let selection = selectOptions.find(
        (album) => album.value == selectAnswer,
      );
      writeJson(selection);
    }
  }
}
