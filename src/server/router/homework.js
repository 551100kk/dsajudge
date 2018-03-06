import express from 'express';
import Problem from '/model/problem';
import Homework from '/model/homework';
import Submission from '/model/submission';
import wrap from 'express-async-wrap';
import _ from 'lodash';
import fs from 'fs';
import bluebird from 'bluebird';
import config from '/config';
import path from 'path';
import {requireLogin} from '/utils';
import HomeworkResult from '/model/homeworkResult';
import {getRank} from '/statistic/rank';
import moment from 'moment';

const router = express.Router();

async function proceedHw(hw, userID, isAdmin) {
    await hw.populate('problems.problem', 'name visible', isAdmin ? {} : {visible: true}).execPopulate();
    const ret = hw.toObject();
    let totalPoints = 0, totalAC = 0;
    const hwRes = await HomeworkResult.findOne()
        .where('homework').equals(hw)
        .where('user').equals(userID);

    const _subs = _.isNil(hwRes) ? null : (await hwRes.getSubresults());

    for (let i = 0; i < hw.problems.length; i++) {
        const subRes = hwRes ? _subs[i] : null;
        let obj = {};
        if (_.isNil(subRes)) {
            obj.userPoints = 0;
            obj.AC = 0;
        } else {
            obj.userPoints = subRes.points;
            obj.AC = (subRes.result === 'AC');
        }
        _.assignIn(ret.problems[i], obj);
    }

    const [rank, totUsers] = await getRank(hw._id, userID);

    ret.status = hw.visible ? (hw.due < Date.now() ? 'ended' : 'running') : 'unpublished';
    ret.userPoints = hwRes ? hwRes.points : 0;
    ret.AC = hwRes ? hwRes.AC : 0;
    if ((rank-1) > totUsers / 2) ret.rank = 0;
    else ret.rank = rank;
    ret.totUsers = totUsers;

    return ret;
}

router.get('/', requireLogin, wrap(async (req, res) => {
    let qry = Homework.find();
    if (!req.user.isAdmin())
        qry = qry.where('visible').equals(true);
    const _data = await qry;
    const data = await Promise.all(_data.map(hw => proceedHw(hw, req.user._id, req.user.isAdmin())));
    data.sort((h1, h2) => {
        if (h1.status != h2.status) {
            const ord = {
                running: 0,
                ended: 1,
                unpublished: 2,
            };
            return ord[h1.status] - ord[h2.status];
        }
        return h1.due - h2.due;
    });
    res.send(data);
}));

router.get('/:id', wrap(async (req, res) => {
    res.send("not construct");
}));

router.post('/:id/submit', requireLogin, wrap(async (req, res) => {
    try{
        const hid=req.params.id;
        const hwDir=path.join(config.dirs.homeworks, hid);
        try {
            await fs.stat(hwDir);
        } catch(e) {
            await fs.mkdir(hwDir);
        }
        const userDir=path.join(hwDir,req.user.meta.id);
        try {
            await fs.stat(userDir);
        } catch(e) {
            await fs.mkdir(userDir);
        }
        const file_name=moment(Date.now()).tz('Asia/Taipei').format('YYYY/MM/DD HH:mm:ss')+".pdf";
        await fs.writeFile(
            path.join(userDir, file_name ),
            req.body.file,
        );
        if(!req.user.homeworks)req.user.homeworks=[];
        const homeworks=req.user.homeworks;
        let filter_res = _.filter(homeworks,_.conforms({ homework_id : id => id==hid }));
        let res ;
        if (filter_res === undefined || filter_res.length == 0){
            res={
                homework_id: hid,
            };
            req.user.homeworks.push(res);
        }else{
            res = filter_res[0];
        }
        res.file_name=file_name;
        await req.user.save();
        res.send(`Upload successfully.`);
    } catch(e) {
        return res.status(500).send(`Something bad happened... Your file may not be saved.`);
    }
}));

export default router;
