const _ = require('lodash');
const j = require('joi');

let reports = {};

//DONE: errorLog <type> --{info}-- --message--
reports.errorLog = (params) => {
  return Promise.resolve()
  //VALIDATE
  .then(() => {
    //validate
    j.assert(params, j.object({
      type: j.string().required(),
      info: j.object().optional(),
      message: j.any().optional()
    }).required());
    return {
      ...params
    };
  })
  // EXECUTE
  .then((filter) => {
    return Promise.resolve()
    .then(() => {
      // convert message
      let message = '';
      //if(_.isError(filter.message)) message = filter.message.stack;
      if(_.isError(filter.message)) message = filter.message;
      else if(_.isObject(filter.message) || _.isArray(filter.message)) message = JSON.stringify(filter.message);
      else message = String(filter.message);
      // console error message
      console.log({
        type: filter.type,
        info: filter.info,
        message
        //message: message.substring(0, 30001)
      });
    })
  })
  // RETURN
  .then((result) => {
    return 'Successfully added ' + result.type + ' error message.';
  })
  .catch((error) => {
    return 'Error: ' + error.toString();
  });
};

module.exports = reports;